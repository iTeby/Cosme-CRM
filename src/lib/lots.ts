import type { Prisma } from "@prisma/client";
import { round3, type Numeric } from "./decimal";
import { applyMovement } from "./inventory";
import type { MovementType } from "./movements";

// Lotes y vencimiento.
//
// FEFO: first expired, first out. Sale primero lo que vence primero, no lo
// que llegó primero. En una panadería con perecibles esa es la diferencia
// entre botar pan y venderlo, y no es una preferencia: es la regla que evita
// que la caja despache el tarro de atrás mientras el de adelante se pasa.
//
// Este módulo decide QUÉ lotes tocar. Quien mueve el stock sigue siendo
// src/lib/inventory.ts: acá no hay ni un tx.stockMovement.create, y el
// snapshot del lote lo mantiene applyMovement junto con el nivel, en la
// misma transacción y con la misma guarda.

export type Tx = Prisma.TransactionClient;

/**
 * Cuántos días antes se avisa, cuando el producto no lo define.
 *
 * Es un piso razonable, no una verdad: el plazo correcto depende del
 * producto y vive en ProductVariant.nearExpiryDays. Una semana avisa a
 * tiempo de casi cualquier abarrote y demasiado tarde para el pan, que por
 * eso necesita el suyo.
 */
export const DIAS_POR_VENCER_POR_DEFECTO = 7;

/** El almacén está en Chile y el día es el día de Chile, no el del servidor. */
const ZONA = "America/Santiago";

/**
 * La medianoche de hoy en Chile, como instante.
 *
 * El vencimiento es un DÍA, no un instante: "vence el 11" significa que el 11
 * todavía se vende. Compararlo contra la hora actual convierte la fecha en un
 * plazo que se cumple a media mañana, y el pan del día deja de poder venderse
 * mientras está sobre el mesón.
 *
 * Y el día tiene que ser el chileno. Tomando el día UTC, a las nueve de la
 * noche de Chile ya es mañana en UTC y todo el turno de la tarde ve los
 * vencimientos corridos un día.
 */
export function inicioDelDia(ahora: Date = new Date()): Date {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
  const [anio, mes, dia] = partes.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia));
}

/** No hay lotes suficientes para cubrir lo pedido. */
export class InsufficientLotStockError extends Error {
  readonly sku?: string;
  readonly faltante: number;
  constructor(faltante: number, sku?: string) {
    super(sku ? `INSUFFICIENT_LOT_STOCK:${sku}` : "INSUFFICIENT_LOT_STOCK");
    this.name = "InsufficientLotStockError";
    this.faltante = faltante;
    this.sku = sku;
  }
}

/** Se intentó despachar de un lote vencido o bloqueado. */
export class LotNotAvailableError extends Error {
  readonly lotId: string;
  constructor(lotId: string) {
    super("LOT_NOT_AVAILABLE");
    this.name = "LotNotAvailableError";
    this.lotId = lotId;
  }
}

export type LoteDisponible = {
  id: string;
  code: string;
  expiresAt: Date | null;
  receivedAt: Date;
  quantity: number;
};

export type Asignacion = {
  lotId: string;
  code: string;
  expiresAt: Date | null;
  cantidad: number;
};

/**
 * Los lotes de los que se puede despachar, en el orden en que hay que
 * hacerlo.
 *
 * Tres reglas de orden, y las tres importan:
 *
 *   1. Vence antes, sale antes. Los que no vencen van al final: no urgen.
 *   2. A igual vencimiento, el que llegó antes. Dos hornadas del mismo día
 *      vencen el mismo día, y rotar por llegada evita que una quede al
 *      fondo para siempre.
 *   3. A igual todo, por id. No aporta nada al negocio y lo aporta todo a
 *      las pruebas: sin un tercer criterio el orden lo decide Postgres y
 *      deja de ser reproducible.
 *
 * Filtra por bodega, no solo por producto. Parece obvio y es el error más
 * fácil de cometer: asignar un lote que está en la panadería para una venta
 * que sale del mesón deja el stock cuadrado en el total y descuadrado en
 * cada bodega.
 */
export async function lotesDisponibles(
  tx: Tx,
  variantId: string,
  warehouseId: string,
  ahora: Date = new Date()
): Promise<LoteDisponible[]> {
  const lotes = await tx.lot.findMany({
    where: {
      variantId,
      warehouseId,
      status: "DISPONIBLE",
      quantity: { gt: 0 },
      // Un lote vencido sigue existiendo y sigue contando en el stock, pero
      // no se despacha. Sacarlo del inventario sería mentir; venderlo, peor.
      //
      // Se compara contra la medianoche de hoy y no contra la hora actual: lo
      // que vence hoy se vende hoy. Con la hora, el pan del día dejaba de
      // poder venderse a media mañana.
      OR: [{ expiresAt: null }, { expiresAt: { gte: inicioDelDia(ahora) } }],
    },
    orderBy: [{ expiresAt: "asc" }, { receivedAt: "asc" }, { id: "asc" }],
    select: { id: true, code: true, expiresAt: true, receivedAt: true, quantity: true },
  });

  // Postgres ordena los NULL al final con ASC, que es justo lo que se quiere
  // —lo que no vence no urge—, pero se deja explícito para no depender de
  // ese detalle si algún día cambia el motor.
  return lotes
    .map((lote) => ({ ...lote, quantity: round3(lote.quantity) }))
    .sort((a, b) => {
      if (a.expiresAt === null && b.expiresAt !== null) return 1;
      if (a.expiresAt !== null && b.expiresAt === null) return -1;
      if (a.expiresAt && b.expiresAt) {
        const diff = a.expiresAt.getTime() - b.expiresAt.getTime();
        if (diff !== 0) return diff;
      }
      const porLlegada = a.receivedAt.getTime() - b.receivedAt.getTime();
      return porLlegada !== 0 ? porLlegada : a.id.localeCompare(b.id);
    });
}

/**
 * Reparte una cantidad entre los lotes disponibles, del que vence primero al
 * que vence después.
 *
 * Es una lectura: no escribe nada y por eso no reserva nada. Entre que se
 * calcula el plan y se aplica, otra caja puede llevarse el mismo lote. Eso
 * NO produce un descuadre: quien aplica es applyMovement, que incrementa de
 * forma atómica y revierte la transacción entera si el lote queda bajo cero.
 * El resultado es que la segunda venta falla limpio y hay que reintentarla,
 * no que el stock mienta.
 */
export function repartirFefo(
  lotes: LoteDisponible[],
  cantidad: Numeric
): { asignaciones: Asignacion[]; faltante: number } {
  let restante = round3(cantidad);
  if (restante <= 0) return { asignaciones: [], faltante: 0 };

  const asignaciones: Asignacion[] = [];
  for (const lote of lotes) {
    if (restante <= 0) break;
    const toma = round3(Math.min(restante, lote.quantity));
    if (toma <= 0) continue;
    asignaciones.push({
      lotId: lote.id,
      code: lote.code,
      expiresAt: lote.expiresAt,
      cantidad: toma,
    });
    restante = round3(restante - toma);
  }

  return { asignaciones, faltante: round3(Math.max(0, restante)) };
}

export type ConsumoFefoInput = {
  variantId: string;
  warehouseId: string;
  cantidad: Numeric;
  type: MovementType;
  userId: string;
  reason?: string | null;
  saleId?: string | null;
  productionId?: string | null;
  sku?: string;
  ahora?: Date;
};

/**
 * Despacha una cantidad tomándola de los lotes que vencen primero.
 *
 * Escribe un movimiento por lote tocado, no uno solo: así el historial dice
 * de qué tanda salió cada unidad, que es lo que permite rastrear hacia atrás
 * cuando algo sale mal con un lote.
 *
 * Si no alcanza, no despacha nada: el error se lanza antes de escribir.
 */
export async function consumirFefo(tx: Tx, input: ConsumoFefoInput) {
  const cantidad = round3(input.cantidad);
  if (cantidad <= 0) throw new Error("INVALID_QUANTITY");

  const disponibles = await lotesDisponibles(
    tx,
    input.variantId,
    input.warehouseId,
    input.ahora ?? new Date()
  );
  const { asignaciones, faltante } = repartirFefo(disponibles, cantidad);

  // Se verifica antes de escribir el primer movimiento. Repartir a medias y
  // fallar en la última línea dejaría la transacción para atrás igual, pero
  // el mensaje sería sobre el último lote en vez de sobre lo que falta.
  if (faltante > 0) throw new InsufficientLotStockError(faltante, input.sku);

  const movimientos = [];
  for (const asignacion of asignaciones) {
    const { movement } = await applyMovement(tx, {
      variantId: input.variantId,
      warehouseId: input.warehouseId,
      type: input.type,
      delta: -asignacion.cantidad,
      userId: input.userId,
      reason: input.reason ?? `Lote ${asignacion.code}`,
      saleId: input.saleId ?? null,
      productionId: input.productionId ?? null,
      sku: input.sku,
      lotId: asignacion.lotId,
    });
    movimientos.push(movement);
  }

  return { asignaciones, movimientos };
}

export type RecepcionLoteInput = {
  variantId: string;
  warehouseId: string;
  code: string;
  cantidad: Numeric;
  expiresAt?: Date | null;
  userId: string;
  reason?: string | null;
  purchaseId?: string | null;
  productionId?: string | null;
  tenantId?: string;
  notes?: string | null;
  /**
   * Cómo entró la mercadería. ENTRADA es una compra; PRODUCCION es lo que se
   * horneó acá, y el pan también nace en un lote: es lo que vence primero de
   * todo el almacén.
   */
  type?: MovementType;
};

/**
 * Ingresa mercadería a un lote, creándolo si es la primera vez.
 *
 * Recibir dos veces el mismo número de lote suma al mismo lote en vez de
 * duplicarlo: el proveedor manda la misma tanda en dos entregas y sigue
 * siendo una sola tanda, con un solo vencimiento.
 *
 * El vencimiento del primer ingreso manda. Si la segunda entrega trae otro,
 * no se pisa en silencio: o es un error de tipeo o no es el mismo lote, y en
 * los dos casos hay que mirarlo.
 */
export async function recibirLote(tx: Tx, input: RecepcionLoteInput) {
  const cantidad = round3(input.cantidad);
  if (cantidad <= 0) throw new Error("INVALID_QUANTITY");

  const tenantId = input.tenantId ?? "cosme";
  const code = input.code.trim();
  if (!code) throw new Error("LOT_CODE_REQUIRED");

  // Upsert y no leer-y-crear: dos personas descargando la misma entrega
  // llegaban las dos a "no existe" y la segunda reventaba contra el índice
  // único con un 500. Con upsert, la que pierde la carrera ve el lote de la
  // que ganó y sigue por el camino normal.
  const lote = await tx.lot.upsert({
    where: {
      tenantId_variantId_warehouseId_code: {
        tenantId,
        variantId: input.variantId,
        warehouseId: input.warehouseId,
        code,
      },
    },
    create: {
      tenantId,
      variantId: input.variantId,
      warehouseId: input.warehouseId,
      code,
      expiresAt: input.expiresAt ?? null,
      notes: input.notes ?? null,
      // La cantidad no se pone acá: la suma applyMovement, para que el
      // snapshot nazca siendo la suma de sus movimientos y no un número
      // escrito aparte que después hay que creerle.
      quantity: 0,
    },
    // Vacío a propósito: el vencimiento del primer ingreso manda.
    update: {},
  });

  if (lote.status !== "DISPONIBLE") throw new LotNotAvailableError(lote.id);

  // Un vencimiento distinto para el mismo número de lote no se pisa en
  // silencio: o es un error de tipeo o no es el mismo lote.
  if (
    input.expiresAt != null &&
    lote.expiresAt?.getTime() !== input.expiresAt.getTime()
  ) {
    throw new Error("LOT_EXPIRY_MISMATCH");
  }

  const { movement } = await applyMovement(tx, {
    variantId: input.variantId,
    warehouseId: input.warehouseId,
    type: input.type ?? "ENTRADA",
    delta: cantidad,
    userId: input.userId,
    reason: input.reason ?? `Ingreso lote ${code}`,
    purchaseId: input.purchaseId ?? null,
    productionId: input.productionId ?? null,
    lotId: lote.id,
  });

  return { lote, movement };
}

/** Días completos entre hoy y el vencimiento. Negativo si ya venció. */
export function diasHastaVencer(expiresAt: Date | null, ahora: Date = new Date()): number | null {
  if (!expiresAt) return null;
  const unDia = 24 * 60 * 60 * 1000;
  // Se compara a medianoche del día chileno: "vence mañana" tiene que dar 1
  // tanto a las nueve de la mañana como a las once de la noche, y a las once
  // de la noche de Chile en UTC ya es mañana.
  const hoy = inicioDelDia(ahora).getTime();
  const dia = Date.UTC(
    expiresAt.getUTCFullYear(),
    expiresAt.getUTCMonth(),
    expiresAt.getUTCDate()
  );
  return Math.round((dia - hoy) / unDia);
}

export type EstadoVencimiento = "VENCIDO" | "POR_VENCER" | "VIGENTE" | "SIN_VENCIMIENTO";

/**
 * En qué situación está un lote.
 *
 * El umbral es por producto y no global, porque no hay un número que sirva
 * para todo: al pan hay que avisarle el mismo día y a un tarro de conservas
 * un mes antes. Nulo cae en el valor por defecto.
 */
export function estadoVencimiento(
  expiresAt: Date | null,
  nearExpiryDays: number | null | undefined,
  ahora: Date = new Date()
): EstadoVencimiento {
  const dias = diasHastaVencer(expiresAt, ahora);
  if (dias === null) return "SIN_VENCIMIENTO";
  if (dias < 0) return "VENCIDO";
  const umbral = nearExpiryDays ?? DIAS_POR_VENCER_POR_DEFECTO;
  return dias <= umbral ? "POR_VENCER" : "VIGENTE";
}

export const estadoVencimientoLabels: Record<EstadoVencimiento, string> = {
  VENCIDO: "Vencido",
  POR_VENCER: "Por vencer",
  VIGENTE: "Vigente",
  SIN_VENCIMIENTO: "Sin vencimiento",
};

export const estadoVencimientoTone: Record<
  EstadoVencimiento,
  "neutral" | "good" | "warn" | "critical"
> = {
  VENCIDO: "critical",
  POR_VENCER: "warn",
  VIGENTE: "good",
  SIN_VENCIMIENTO: "neutral",
};

/** El vencimiento que corresponde según la vida útil declarada del producto. */
export function vencimientoSugerido(
  shelfLifeDays: number | null | undefined,
  desde: Date = new Date()
): Date | null {
  if (shelfLifeDays == null || shelfLifeDays <= 0) return null;
  // Se cuenta desde la medianoche chilena, no desde la hora local del
  // proceso: a las diez de la noche, sumar un día en UTC proponía pasado
  // mañana, que es justo el turno en que se recibe el pan del día siguiente.
  const fecha = inicioDelDia(desde);
  fecha.setUTCDate(fecha.getUTCDate() + shelfLifeDays);
  return fecha;
}

/** La fecha en formato AAAA-MM-DD, en día chileno, para un input date. */
export function fechaParaInput(fecha: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(fecha);
}

/**
 * Marca como VENCIDOS los lotes cuya fecha ya pasó y todavía tienen stock.
 *
 * No descuenta nada: lo vencido sigue estando físicamente en la bodega hasta
 * que alguien lo bote, y botarlo es una merma que se registra a mano y con
 * su motivo. Esto solo deja de ofrecerlo para la venta.
 */
export async function marcarVencidos(tx: Tx, ahora: Date = new Date()): Promise<number> {
  const resultado = await tx.lot.updateMany({
    // Antes de hoy, no antes de ahora: lo que vence hoy todavía se vende.
    where: {
      status: "DISPONIBLE",
      expiresAt: { lt: inicioDelDia(ahora) },
      quantity: { gt: 0 },
    },
    data: { status: "VENCIDO" },
  });
  return resultado.count;
}
