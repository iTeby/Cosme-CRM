import { round3, toNumber } from "../decimal";

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

  productVariant = {
    findUnique: async ({ where }: any) => ({ id: where.id, sku: `SKU-${where.id}` }),
    findMany: async ({ where }: any) =>
      (where?.id?.in ?? []).map((id: string) => ({ id, sku: `SKU-${id}` })),
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
    try {
      return await fn();
    } catch (err) {
      this.levels = levels;
      this.movements = movements;
      this.productions = productions;
      this.productionItems = productionItems;
      throw err;
    }
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
