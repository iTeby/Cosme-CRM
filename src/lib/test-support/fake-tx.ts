import { round2, round3, toNumber } from "../decimal";

// Doble en memoria de la transacción de Prisma. Implementa solo lo que la
// lógica de inventario y producción consume. No reemplaza una prueba contra
// Postgres — no verifica transaccionalidad real ni restricciones de la base —
// pero sí verifica lo que desincroniza el inventario en silencio: los signos,
// la aritmética, el redondeo y la invariante de que StockLevel es siempre la
// suma de los movimientos.
//
// Solo lo usan los tests. Ningún código de la aplicación lo importa.

export type FakeMovement = {
  id: string;
  variantId: string;
  warehouseId: string;
  type: string;
  quantity: number;
  reason: string | null;
  userId: string;
  saleId: string | null;
  purchaseId: string | null;
  productionId: string | null;
  lotId?: string | null;
};

export type FakeSale = {
  id: string;
  number: number;
  customerId: string;
  status: string;
  totalAmount: number;
  paidAmount: number;
  shiftId: string | null;
  createdAt: number;
};

export type FakePayment = {
  id: string;
  customerId: string;
  saleId: string | null;
  shiftId: string | null;
  amount: number;
  method: string;
  notes: string | null;
  createdById: string;
};

export type FakeLot = {
  id: string;
  tenantId: string;
  variantId: string;
  warehouseId: string;
  code: string;
  expiresAt: Date | null;
  receivedAt: Date;
  quantity: number;
  status: string;
  notes: string | null;
};

export type FakeShift = {
  id: string;
  number: number;
  warehouseId: string;
  tenantId: string;
  status: string;
  openKey: string | null;
  openingAmount: number;
  cashOps: number;
  expectedAmount: number | null;
  countedAmount: number | null;
  difference: number | null;
  openingNotes: string | null;
  closingNotes: string | null;
  openedById: string;
  closedById: string | null;
  closedAt: Date | null;
};

export type FakeDte = {
  id: string;
  tenantId: string;
  saleId: string;
  type: string;
  environment: string;
  provider: string;
  status: string;
  folio: number | null;
  netAmount: number;
  taxAmount: number;
  totalAmount: number;
  roundingDelta: number;
  idempotencyKey: string;
  externalId: string | null;
  trackId: string | null;
  pdfUrl: string | null;
  rawResponse: string | null;
  errorMessage: string | null;
  issuedAt: Date | null;
  updatedAt: Date;
};

export type FakeRecipe = {
  variantId: string;
  yield: number;
  items: { variantId: string; quantity: number }[];
};

/**
 * Prisma devuelve Decimal como objeto cuyo valueOf entrega un string, no un
 * number. Sumarlo con + concatena en silencio; esta clase permite probar ese
 * caso sin depender de Decimal.js.
 */
export class Dec {
  readonly raw: string;
  constructor(raw: string) {
    this.raw = raw;
  }
  toString() {
    return this.raw;
  }
  valueOf() {
    return this.raw;
  }
}

/**
 * Interpreta el `where` de los documentos, incluido el `OR` con la ventana de
 * tiempo que usa prepararDte para distinguir una emisión en curso de un
 * proceso que se cayó. Sin eso, el test no probaría la rama que importa.
 */
function matchDte(d: FakeDte, where: any): boolean {
  if (!where) return true;
  if (where.OR) return where.OR.some((rama: any) => matchDte(d, rama));
  if (where.id !== undefined && d.id !== where.id) return false;
  if (where.saleId !== undefined && d.saleId !== where.saleId) return false;
  if (where.environment !== undefined && d.environment !== where.environment) return false;
  if (where.status !== undefined) {
    if (typeof where.status === "string") {
      if (d.status !== where.status) return false;
    } else if (where.status.in && !where.status.in.includes(d.status)) {
      return false;
    }
  }
  if (where.updatedAt?.lt !== undefined && !(d.updatedAt < where.updatedAt.lt)) return false;
  return true;
}

export class FakeTx {
  levels = new Map<string, number>();
  movements: FakeMovement[] = [];
  recipes = new Map<string, FakeRecipe>();
  productions: { id: string; number: number; warehouseId: string; createdById: string }[] = [];
  productionItems: {
    productionId: string;
    variantId: string;
    quantityProduced: number;
    quantityWasted: number;
  }[] = [];
  sales: FakeSale[] = [];
  payments: FakePayment[] = [];
  shifts: FakeShift[] = [];
  dtes: FakeDte[] = [];
  lots: FakeLot[] = [];
  levelReads = 0;
  private seq = 0;

  private key(variantId: string, warehouseId: string) {
    return `${variantId}:${warehouseId}`;
  }

  stockLevel = {
    findUnique: async ({ where }: any) => {
      const { variantId, warehouseId } = where.variantId_warehouseId;
      this.levelReads += 1;
      const k = this.key(variantId, warehouseId);
      return this.levels.has(k)
        ? { variantId, warehouseId, quantity: this.levels.get(k)! }
        : null;
    },
    // Emula el upsert de Prisma, incluido el incremento atómico
    // `{ quantity: { increment: n } }` que usa inventory.ts para que la suma
    // la haga la base y no JavaScript.
    upsert: async ({ where, create, update }: any) => {
      const { variantId, warehouseId } = where.variantId_warehouseId;
      const k = this.key(variantId, warehouseId);
      const exists = this.levels.has(k);
      let next: number;
      if (!exists) {
        next = create.quantity;
      } else if (update.quantity && typeof update.quantity === "object") {
        // toNumber porque el nivel sembrado puede ser un Decimal simulado,
        // igual que lo que devuelve Prisma.
        next = round3(toNumber(this.levels.get(k)) + update.quantity.increment);
      } else {
        next = update.quantity;
      }
      this.levels.set(k, next);
      return { variantId, warehouseId, quantity: next };
    },
  };

  stockMovement = {
    create: async ({ data }: any) => {
      const m: FakeMovement = {
        id: `m${++this.seq}`,
        reason: null,
        saleId: null,
        purchaseId: null,
        productionId: null,
        lotId: null,
        ...data,
      };
      this.movements.push(m);
      return m;
    },
    update: async ({ where, data }: any) => {
      const m = this.movements.find((x) => x.id === where.id)!;
      Object.assign(m, data);
      return m;
    },
    delete: async ({ where }: any) => {
      const i = this.movements.findIndex((x) => x.id === where.id);
      // findIndex da -1 y splice(-1, 1) borraría el ÚLTIMO movimiento en vez
      // de fallar, tapando un id equivocado y rompiendo sumFor de paso.
      // Prisma lanzaría P2025.
      if (i === -1) throw new Error("P2025_RECORD_NOT_FOUND");
      return this.movements.splice(i, 1)[0];
    },
  };

  sale = {
    findUnique: async ({ where }: any) => this.sales.find((s) => s.id === where.id) ?? null,
    findMany: async ({ where }: any) =>
      this.sales
        .filter((s) => s.customerId === where.customerId)
        .filter((s) => (where.status?.not ? s.status !== where.status.not : true))
        .sort((a, b) => a.createdAt - b.createdAt),
    findUniqueOrThrow: async ({ where }: any) => {
      const venta = this.sales.find((s) => s.id === where.id);
      if (!venta) throw new Error("P2025_RECORD_NOT_FOUND");
      return venta;
    },
    updateMany: async ({ where, data }: any) => {
      const alcanzadas = this.sales.filter(
        (s) =>
          s.id === where.id &&
          (where.status?.not ? s.status !== where.status.not : true) &&
          (where.status && typeof where.status === "string" ? s.status === where.status : true)
      );
      for (const venta of alcanzadas) {
        const cambio = data.paidAmount;
        if (cambio && typeof cambio === "object" && cambio.increment !== undefined) {
          venta.paidAmount = round2(venta.paidAmount + cambio.increment);
        }
        if (data.status !== undefined) venta.status = data.status;
      }
      return { count: alcanzadas.length };
    },
    count: async ({ where }: any) =>
      this.sales.filter((s) => (where?.shiftId !== undefined ? s.shiftId === where.shiftId : true))
        .length,
    update: async ({ where, data }: any) => {
      const venta = this.sales.find((s) => s.id === where.id);
      if (!venta) throw new Error("P2025_RECORD_NOT_FOUND");
      const cambio = data.paidAmount;
      if (cambio && typeof cambio === "object") {
        if (cambio.increment !== undefined) {
          venta.paidAmount = round2(venta.paidAmount + cambio.increment);
        } else if (cambio.decrement !== undefined) {
          venta.paidAmount = round2(venta.paidAmount - cambio.decrement);
        }
      } else if (cambio !== undefined) {
        venta.paidAmount = round2(cambio);
      }
      if (data.status !== undefined) venta.status = data.status;
      return venta;
    },
  };

  payment = {
    create: async ({ data }: any) => {
      const pago: FakePayment = {
        id: `pg${++this.seq}`,
        notes: null,
        saleId: null,
        shiftId: null,
        ...data,
      };
      this.payments.push(pago);
      return pago;
    },
    // El select de `shift` se resuelve acá porque removePayment necesita saber
    // si el turno del pago sigue abierto antes de dejar deshacerlo.
    findUnique: async ({ where, select }: any) => {
      const pago = this.payments.find((p) => p.id === where.id);
      if (!pago) return null;
      if (!select?.shift) return pago;
      const turno = this.shifts.find((t) => t.id === pago.shiftId) ?? null;
      return {
        ...pago,
        shift: turno ? { id: turno.id, status: turno.status, number: turno.number } : null,
      };
    },
    delete: async ({ where }: any) => {
      const i = this.payments.findIndex((p) => p.id === where.id);
      if (i === -1) throw new Error("P2025_RECORD_NOT_FOUND");
      return this.payments.splice(i, 1)[0];
    },
    count: async ({ where }: any) =>
      this.payments.filter((p) => (where?.saleId ? p.saleId === where.saleId : true)).length,
    aggregate: async ({ where }: any) => {
      const filtrados = this.payments
        .filter((p) => (where?.shiftId !== undefined ? p.shiftId === where.shiftId : true))
        .filter((p) => (where?.method ? p.method === where.method : true));
      return {
        _sum: {
          amount: round2(filtrados.reduce((acc, p) => acc + p.amount, 0)),
        },
      };
    },
    groupBy: async ({ where }: any) => {
      const filtrados = this.payments.filter((p) =>
        where?.shiftId !== undefined ? p.shiftId === where.shiftId : true
      );
      const porMetodo = new Map<string, number>();
      for (const pago of filtrados) {
        porMetodo.set(pago.method, round2((porMetodo.get(pago.method) ?? 0) + pago.amount));
      }
      return [...porMetodo.entries()].map(([method, amount]) => ({
        method,
        _sum: { amount },
      }));
    },
  };

  cashShift = {
    create: async ({ data }: any) => {
      // El índice único de openKey: es lo que impide dos turnos abiertos a la
      // vez en la misma bodega, y el test tiene que poder verlo fallar.
      if (data.openKey && this.shifts.some((t) => t.openKey === data.openKey)) {
        const err: any = new Error("Unique constraint failed");
        err.code = "P2002";
        err.meta = { target: ["openKey"] };
        throw err;
      }
      const turno: FakeShift = {
        id: `t${++this.seq}`,
        number: this.shifts.length + 1,
        tenantId: "cosme",
        status: "ABIERTO",
        openKey: null,
        openingAmount: 0,
        cashOps: 0,
        expectedAmount: null,
        countedAmount: null,
        difference: null,
        openingNotes: null,
        closingNotes: null,
        closedById: null,
        closedAt: null,
        ...data,
      };
      this.shifts.push(turno);
      return turno;
    },
    findUnique: async ({ where }: any) => this.findShift(where) ?? null,
    findUniqueOrThrow: async ({ where }: any) => {
      const turno = this.findShift(where);
      if (!turno) throw new Error("P2025_RECORD_NOT_FOUND");
      return turno;
    },
    updateMany: async ({ where, data }: any) => {
      const alcanzados = this.shifts.filter(
        (t) =>
          (where.id === undefined || t.id === where.id) &&
          (where.openKey === undefined || t.openKey === where.openKey) &&
          (where.status === undefined || t.status === where.status)
      );
      for (const turno of alcanzados) this.applyShiftData(turno, data);
      return { count: alcanzados.length };
    },
    update: async ({ where, data }: any) => {
      const turno = this.findShift(where);
      if (!turno) throw new Error("P2025_RECORD_NOT_FOUND");
      this.applyShiftData(turno, data);
      return turno;
    },
  };

  private findShift(where: any): FakeShift | undefined {
    if (where.id !== undefined) return this.shifts.find((t) => t.id === where.id);
    if (where.openKey !== undefined) return this.shifts.find((t) => t.openKey === where.openKey);
    return undefined;
  }

  private applyShiftData(turno: FakeShift, data: any) {
    for (const [campo, valor] of Object.entries(data)) {
      if (valor && typeof valor === "object" && "increment" in (valor as any)) {
        (turno as any)[campo] = (turno as any)[campo] + (valor as any).increment;
      } else {
        (turno as any)[campo] = valor;
      }
    }
  }

  dte = {
    create: async ({ data }: any) => {
      // El índice único de idempotencyKey. Prisma lanza P2002 y —esto es lo
      // que importa reproducir— en Postgres eso deja la transacción abortada:
      // el código no puede capturarlo y seguir usando tx.
      if (this.dtes.some((d) => d.idempotencyKey === data.idempotencyKey)) {
        const err: any = new Error("Unique constraint failed");
        err.code = "P2002";
        err.meta = { target: ["idempotencyKey"] };
        throw err;
      }
      const fila: FakeDte = {
        id: `dte${++this.seq}`,
        tenantId: "cosme",
        folio: null,
        roundingDelta: 0,
        externalId: null,
        trackId: null,
        pdfUrl: null,
        rawResponse: null,
        errorMessage: null,
        issuedAt: null,
        updatedAt: new Date(),
        ...data,
      };
      this.dtes.push(fila);
      return fila;
    },
    findUnique: async ({ where }: any) => this.findDte(where) ?? null,
    findUniqueOrThrow: async ({ where }: any) => {
      const fila = this.findDte(where);
      if (!fila) throw new Error("P2025_RECORD_NOT_FOUND");
      return fila;
    },
    findFirst: async ({ where }: any) =>
      this.dtes.find((d) => matchDte(d, where)) ?? null,
    count: async ({ where }: any) => this.dtes.filter((d) => matchDte(d, where)).length,
    updateMany: async ({ where, data }: any) => {
      const alcanzados = this.dtes.filter((d) => matchDte(d, where));
      for (const fila of alcanzados) {
        Object.assign(fila, data);
        fila.updatedAt = new Date();
      }
      return { count: alcanzados.length };
    },
    update: async ({ where, data }: any) => {
      const fila = this.findDte(where);
      if (!fila) throw new Error("P2025_RECORD_NOT_FOUND");
      Object.assign(fila, data);
      fila.updatedAt = new Date();
      return fila;
    },
  };

  private findDte(where: any): FakeDte | undefined {
    if (where.id !== undefined) return this.dtes.find((d) => d.id === where.id);
    if (where.idempotencyKey !== undefined) {
      return this.dtes.find((d) => d.idempotencyKey === where.idempotencyKey);
    }
    return undefined;
  }

  /** Carga un documento ya existente, para probar las ramas de reintento. */
  seedDte(parcial: Partial<FakeDte> & { idempotencyKey: string; saleId: string }) {
    const fila: FakeDte = {
      id: `dte-seed-${this.dtes.length + 1}`,
      tenantId: "cosme",
      type: "BOLETA",
      environment: "CERTIFICACION",
      provider: "simulado",
      status: "PENDIENTE",
      folio: null,
      netAmount: 0,
      taxAmount: 0,
      totalAmount: 0,
      roundingDelta: 0,
      externalId: null,
      trackId: null,
      pdfUrl: null,
      rawResponse: null,
      errorMessage: null,
      issuedAt: null,
      updatedAt: new Date(),
      ...parcial,
    };
    this.dtes.push(fila);
    return fila;
  }

  lot = {
    findMany: async ({ where, orderBy }: any) => {
      let filas = this.lots.filter((l) => {
        if (where.variantId !== undefined && l.variantId !== where.variantId) return false;
        if (where.warehouseId !== undefined && l.warehouseId !== where.warehouseId) return false;
        if (where.status !== undefined && l.status !== where.status) return false;
        if (where.quantity?.gt !== undefined && !(l.quantity > where.quantity.gt)) return false;
        if (where.OR) {
          const pasa = where.OR.some((rama: any) => {
            if (rama.expiresAt === null) return l.expiresAt === null;
            if (rama.expiresAt?.gte) return l.expiresAt !== null && l.expiresAt >= rama.expiresAt.gte;
            if (rama.expiresAt?.lt) return l.expiresAt !== null && l.expiresAt < rama.expiresAt.lt;
            return true;
          });
          if (!pasa) return false;
        }
        return true;
      });
      // El orden real lo hace Postgres; acá se emula el del índice para que
      // el test verifique el reparto y no el orden de inserción del array.
      if (orderBy) {
        filas = [...filas].sort((a, b) => {
          const av = a.expiresAt ? a.expiresAt.getTime() : Number.POSITIVE_INFINITY;
          const bv = b.expiresAt ? b.expiresAt.getTime() : Number.POSITIVE_INFINITY;
          if (av !== bv) return av - bv;
          const ar = a.receivedAt.getTime();
          const br = b.receivedAt.getTime();
          return ar !== br ? ar - br : a.id.localeCompare(b.id);
        });
      }
      return filas.map((l) => ({ ...l }));
    },
    findUnique: async ({ where }: any) => {
      if (where.id !== undefined) return this.lots.find((l) => l.id === where.id) ?? null;
      const clave = where.tenantId_variantId_warehouseId_code;
      if (!clave) return null;
      return (
        this.lots.find(
          (l) =>
            l.tenantId === clave.tenantId &&
            l.variantId === clave.variantId &&
            l.warehouseId === clave.warehouseId &&
            l.code === clave.code
        ) ?? null
      );
    },
    create: async ({ data }: any) => {
      const lote: FakeLot = {
        id: `lote${++this.seq}`,
        tenantId: "cosme",
        expiresAt: null,
        receivedAt: new Date(),
        quantity: 0,
        status: "DISPONIBLE",
        notes: null,
        ...data,
      };
      this.lots.push(lote);
      return lote;
    },
    upsert: async ({ where, create }: any) => {
      const clave = where.tenantId_variantId_warehouseId_code;
      const existente = this.lots.find(
        (l) =>
          l.tenantId === clave.tenantId &&
          l.variantId === clave.variantId &&
          l.warehouseId === clave.warehouseId &&
          l.code === clave.code
      );
      // `update` vacío: el lote existente se devuelve tal cual, que es lo
      // que hace Prisma y lo que el código espera para que mande el
      // vencimiento del primer ingreso.
      if (existente) return existente;
      const lote: FakeLot = {
        id: `lote${++this.seq}`,
        tenantId: "cosme",
        expiresAt: null,
        receivedAt: new Date(),
        quantity: 0,
        status: "DISPONIBLE",
        notes: null,
        ...create,
      };
      this.lots.push(lote);
      return lote;
    },
    update: async ({ where, data }: any) => {
      const lote = this.lots.find((l) => l.id === where.id);
      if (!lote) throw new Error("P2025_RECORD_NOT_FOUND");
      if (data.quantity && typeof data.quantity === "object" && data.quantity.increment !== undefined) {
        lote.quantity = round3(toNumber(lote.quantity) + data.quantity.increment);
      } else if (data.quantity !== undefined) {
        lote.quantity = round3(data.quantity);
      }
      if (data.status !== undefined) lote.status = data.status;
      if (data.expiresAt !== undefined) lote.expiresAt = data.expiresAt;
      return lote;
    },
    updateMany: async ({ where, data }: any) => {
      const alcanzados = this.lots.filter((l) => {
        if (where.status !== undefined && l.status !== where.status) return false;
        if (where.quantity?.gt !== undefined && !(l.quantity > where.quantity.gt)) return false;
        if (where.expiresAt?.lt !== undefined) {
          if (l.expiresAt === null || !(l.expiresAt < where.expiresAt.lt)) return false;
        }
        return true;
      });
      for (const lote of alcanzados) {
        if (data.status !== undefined) lote.status = data.status;
      }
      return { count: alcanzados.length };
    },
  };

  /** Carga un lote con su stock ya puesto, sin pasar por la recepción. */
  seedLot(
    id: string,
    variantId: string,
    warehouseId: string,
    quantity: number,
    opts: { code?: string; expiresAt?: Date | null; receivedAt?: Date; status?: string } = {}
  ) {
    const lote: FakeLot = {
      id,
      tenantId: "cosme",
      variantId,
      warehouseId,
      code: opts.code ?? id,
      expiresAt: opts.expiresAt ?? null,
      receivedAt: opts.receivedAt ?? new Date("2026-01-01T00:00:00Z"),
      quantity,
      status: opts.status ?? "DISPONIBLE",
      notes: null,
    };
    this.lots.push(lote);
    // El nivel tiene que reflejarlo: el lote es un corte del mismo stock.
    const k = this.key(variantId, warehouseId);
    this.levels.set(k, round3(toNumber(this.levels.get(k) ?? 0) + quantity));
    return lote;
  }

  lotById(id: string) {
    return this.lots.find((l) => l.id === id)!;
  }

  /** La invariante del lote: su cantidad es la suma de sus movimientos. */
  lotSumFor(lotId: string) {
    return round3(
      this.movements.filter((m) => (m as any).lotId === lotId).reduce((acc, m) => acc + m.quantity, 0)
    );
  }

  /**
   * Configuración de las variantes que el código consulta: si llevan lote y
   * con qué vida útil. Por defecto no llevan, que es como nace todo.
   */
  variantConfig = new Map<string, { tracksLots: boolean; shelfLifeDays: number | null }>();

  seedVariant(
    id: string,
    opts: { tracksLots?: boolean; shelfLifeDays?: number | null } = {}
  ) {
    this.variantConfig.set(id, {
      tracksLots: opts.tracksLots ?? false,
      shelfLifeDays: opts.shelfLifeDays ?? null,
    });
  }

  private variantOf(id: string) {
    const cfg = this.variantConfig.get(id) ?? { tracksLots: false, shelfLifeDays: null };
    return { id, sku: `SKU-${id}`, ...cfg };
  }

  productVariant = {
    findUnique: async ({ where }: any) => this.variantOf(where.id),
    findMany: async ({ where }: any) =>
      (where?.id?.in ?? []).map((id: string) => this.variantOf(id)),
  };

  recipe = {
    findUnique: async ({ where }: any) => {
      const r = this.recipes.get(where.variantId);
      return r ? { ...r, active: this.inactiveRecipes.has(where.variantId) ? false : true } : null;
    },
    findMany: async ({ where }: any) =>
      (where?.variantId?.in ?? [])
        .map((id: string) => this.recipes.get(id))
        .filter(Boolean)
        .map((r: any) => ({ ...r, active: !this.inactiveRecipes.has(r.variantId) })),
  };

  /** Recetas marcadas como no vigentes, para poder probar esa rama. */
  inactiveRecipes = new Set<string>();

  productionOrder = {
    create: async ({ data }: any) => {
      const o = { id: `p${++this.seq}`, number: this.productions.length + 1, ...data };
      this.productions.push(o);
      return o;
    },
    findUniqueOrThrow: async ({ where }: any) =>
      this.productions.find((p) => p.id === where.id)!,
  };

  productionItem = {
    create: async ({ data }: any) => {
      const i = { quantityWasted: 0, ...data };
      this.productionItems.push(i);
      return i;
    },
  };

  /**
   * Emula una transacción de Postgres: si la función lanza, todo lo escrito
   * dentro se revierte. Hace falta porque la lógica de inventario escribe el
   * nivel primero y valida después —para que la suma la haga la base y no
   * JavaScript—, así que sin rollback los tests de "no escribe nada" verían
   * el estado intermedio que en producción nunca existe.
   */
  async inTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const levels = new Map(this.levels);
    const movements = this.movements.map((m) => ({ ...m }));
    const productions = [...this.productions];
    const productionItems = [...this.productionItems];
    const sales = this.sales.map((s) => ({ ...s }));
    const payments = this.payments.map((p) => ({ ...p }));
    const shifts = this.shifts.map((t) => ({ ...t }));
    const dtes = this.dtes.map((d) => ({ ...d }));
    const lots = this.lots.map((l) => ({ ...l }));
    try {
      return await fn();
    } catch (err) {
      this.levels = levels;
      this.movements = movements;
      this.productions = productions;
      this.productionItems = productionItems;
      this.sales = sales;
      this.payments = payments;
      this.shifts = shifts;
      this.dtes = dtes;
      this.lots = lots;
      throw err;
    }
  }

  /** Carga una venta con su total y lo ya abonado. */
  seedSale(
    id: string,
    customerId: string,
    totalAmount: number,
    opts: { paid?: number; status?: string; order?: number; shiftId?: string } = {}
  ) {
    this.sales.push({
      id,
      number: this.sales.length + 1,
      customerId,
      status: opts.status ?? "PENDIENTE",
      totalAmount,
      paidAmount: opts.paid ?? 0,
      shiftId: opts.shiftId ?? null,
      createdAt: opts.order ?? this.sales.length,
    });
  }

  /** Carga un turno ya abierto, para no depender de openShift en cada test. */
  seedShift(id: string, warehouseId: string, openingAmount: number, tenantId = "cosme") {
    const turno: FakeShift = {
      id,
      number: this.shifts.length + 1,
      warehouseId,
      tenantId,
      status: "ABIERTO",
      openKey: `${tenantId}:${warehouseId}`,
      openingAmount,
      cashOps: 0,
      expectedAmount: null,
      countedAmount: null,
      difference: null,
      openingNotes: null,
      closingNotes: null,
      openedById: "u1",
      closedById: null,
      closedAt: null,
    };
    this.shifts.push(turno);
    return turno;
  }

  shiftById(id: string) {
    return this.shifts.find((t) => t.id === id)!;
  }

  /** La invariante del fiado: lo abonado es la suma de los pagos de esa venta. */
  paidSumFor(saleId: string) {
    return round2(
      this.payments.filter((p) => p.saleId === saleId).reduce((acc, p) => acc + p.amount, 0)
    );
  }

  saleById(id: string) {
    return this.sales.find((s) => s.id === id)!;
  }

  /** Carga una receta: rinde `yield` unidades consumiendo `items`. */
  seedRecipe(variantId: string, yieldQty: number, items: [string, number][]) {
    this.recipes.set(variantId, {
      variantId,
      yield: yieldQty,
      items: items.map(([v, q]) => ({ variantId: v, quantity: q })),
    });
  }

  /**
   * La invariante que protege todo: el snapshot es la suma del historial.
   * Se redondea porque en la base los valores son numeric(12,3) y su suma es
   * exacta; sumarlos en punto flotante inventa colas que la base no tiene.
   */
  sumFor(variantId: string, warehouseId: string) {
    return round3(
      this.movements
        .filter((m) => m.variantId === variantId && m.warehouseId === warehouseId)
        .reduce((acc, m) => acc + m.quantity, 0)
    );
  }

  levelFor(variantId: string, warehouseId: string) {
    return this.levels.get(this.key(variantId, warehouseId)) ?? 0;
  }

  movementsOfType(type: string) {
    return this.movements.filter((m) => m.type === type);
  }
}
