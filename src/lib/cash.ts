import type { Prisma } from "@prisma/client";
import { round2, toNumber, type Numeric } from "./decimal";

// Caja y turno.
//
// Un turno es el período entre que alguien abre el cajón con un fondo y lo
// cierra contando lo que hay dentro. Existe para responder una sola pregunta,
// la que se hace todos los días al cerrar: ¿la plata que hay en el cajón es la
// que debería haber? La respuesta es la diferencia, y que no sea cero no es un
// error del sistema: es información sobre el día.
//
// Este módulo es la única puerta de escritura de turnos.

export type Tx = Prisma.TransactionClient;

/** Ya hay un turno abierto en esa bodega. */
export class ShiftAlreadyOpenError extends Error {
  constructor() {
    super("SHIFT_ALREADY_OPEN");
    this.name = "ShiftAlreadyOpenError";
  }
}

/** Se intentó una operación de efectivo sin turno abierto. */
export class NoOpenShiftError extends Error {
  constructor() {
    super("NO_OPEN_SHIFT");
    this.name = "NoOpenShiftError";
  }
}

/** El turno ya estaba cerrado (o alguien lo cerró primero). */
export class ShiftAlreadyClosedError extends Error {
  constructor() {
    super("SHIFT_ALREADY_CLOSED");
    this.name = "ShiftAlreadyClosedError";
  }
}

/**
 * La llave de unicidad del turno abierto.
 *
 * Va a una columna con índice único. Mientras el turno está abierto vale
 * "<tenant>:<bodega>"; al cerrarlo pasa a NULL. Postgres no considera iguales
 * dos NULL en un índice único, así que los turnos cerrados conviven y dos
 * aperturas simultáneas de la misma bodega chocan en la base. Verificarlo con
 * un SELECT previo dejaría la ventana entre la lectura y el INSERT.
 */
export function openKeyFor(tenantId: string, warehouseId: string): string {
  return `${tenantId}:${warehouseId}`;
}

export type OpenShiftInput = {
  warehouseId: string;
  openingAmount: Numeric;
  userId: string;
  tenantId?: string;
  notes?: string | null;
};

export async function openShift(tx: Tx, input: OpenShiftInput) {
  const tenantId = input.tenantId ?? "cosme";
  const openingAmount = round2(input.openingAmount);
  if (openingAmount < 0) throw new Error("INVALID_OPENING_AMOUNT");

  try {
    return await tx.cashShift.create({
      data: {
        tenantId,
        warehouseId: input.warehouseId,
        openKey: openKeyFor(tenantId, input.warehouseId),
        openingAmount,
        openingNotes: input.notes || null,
        openedById: input.userId,
      },
    });
  } catch (err: unknown) {
    // Solo el choque de openKey significa "ya hay un turno abierto". La tabla
    // tiene otro índice único —`number`, que es un SERIAL— y una secuencia
    // desfasada (pasa al restaurar un dump o clonar una rama de Neon) también
    // lanza P2002. Traducirlo todo a "ciérralo antes de abrir otro" mandaría
    // al cajero a cerrar un turno que no existe, con la caja sin poder abrir
    // y el error real sin llegar a los logs.
    const code = (err as { code?: string })?.code;
    const target = (err as { meta?: { target?: string[] } })?.meta?.target ?? [];
    if (code === "P2002" && target.includes("openKey")) throw new ShiftAlreadyOpenError();
    throw err;
  }
}

/** El turno abierto de una bodega, o null. */
export async function currentShift(tx: Tx, warehouseId: string, tenantId = "cosme") {
  return tx.cashShift.findUnique({
    where: { openKey: openKeyFor(tenantId, warehouseId) },
  });
}

/**
 * Reserva el turno para una operación en efectivo. Devuelve false si el turno
 * ya no está abierto.
 *
 * El incremento de `cashOps` no es contabilidad: es lo que toma el lock de la
 * fila del turno. Sin él, un cobro en efectivo podría commitear entre el
 * momento en que el cierre congela el esperado y el conteo, y esa plata
 * quedaría fuera del arqueo sin dejar rastro de por qué no cuadra. Con él, el
 * cierre y los cobros en efectivo del mismo turno se serializan: el cobro que
 * llegue tarde encuentra el turno CERRADO —la reevaluación de READ COMMITTED
 * mira la versión nueva de la fila— y se aborta entero.
 *
 * Que el cajón se serialice no es un costo: el cajón es uno solo y físico.
 *
 * Es el único punto donde se reclama, y lo llama payments.ts tanto al cobrar
 * como al deshacer. Reclamar también en la ruta duplicaría el conteo sin
 * agregar seguridad: el lock ya está tomado dentro de la misma transacción.
 */
export async function claimShiftForCashById(tx: Tx, shiftId: string): Promise<boolean> {
  const reclamado = await tx.cashShift.updateMany({
    where: { id: shiftId, status: "ABIERTO" },
    data: { cashOps: { increment: 1 } },
  });
  return reclamado.count > 0;
}

/**
 * El id del turno abierto de una bodega, o NoOpenShiftError si no hay.
 *
 * Es una lectura, no un reclamo: el lock lo toma después
 * claimShiftForCashById dentro de la misma transacción. Si el turno se
 * cierra entremedio, ese reclamo falla y la operación se aborta entera.
 */
export async function requireOpenShift(
  tx: Tx,
  warehouseId: string,
  tenantId = "cosme"
): Promise<string> {
  const turno = await currentShift(tx, warehouseId, tenantId);
  if (!turno) throw new NoOpenShiftError();
  return turno.id;
}

/**
 * Efectivo que el sistema espera en el cajón: el fondo más todo lo cobrado en
 * efectivo dentro del turno.
 *
 * Se suma sobre los pagos vivos, no sobre un contador: deshacer un abono borra
 * la fila y el esperado baja solo, igual que paidAmount en la venta.
 */
export async function expectedCash(tx: Tx, shiftId: string): Promise<number> {
  const turno = await tx.cashShift.findUniqueOrThrow({
    where: { id: shiftId },
    select: { openingAmount: true },
  });

  const efectivo = await tx.payment.aggregate({
    where: { shiftId, method: "EFECTIVO" },
    _sum: { amount: true },
  });

  return round2(toNumber(turno.openingAmount) + toNumber(efectivo._sum?.amount ?? 0));
}

export type CloseShiftInput = {
  countedAmount: Numeric;
  userId: string;
  notes?: string | null;
};

/**
 * Cierra el turno y congela el arqueo.
 *
 * El orden importa: primero se reclama el turno —que toma el lock de la fila y
 * lo saca de ABIERTO en el mismo statement—, y recién después se suma el
 * efectivo. Al revés, un cobro que entrara entremedio no aparecería en el
 * esperado pero sí en el cajón, y la diferencia culparía al cajero.
 *
 * `expectedAmount` queda guardado, no se recalcula al mostrarlo: el arqueo es
 * lo que se supo en ese momento. Si mañana alguien deshace un abono de ayer,
 * el cierre de ayer sigue diciendo lo que dijo, y eso es lo correcto.
 */
export async function closeShift(tx: Tx, shiftId: string, input: CloseShiftInput) {
  const countedAmount = round2(input.countedAmount);
  if (countedAmount < 0) throw new Error("INVALID_COUNTED_AMOUNT");

  const reclamado = await tx.cashShift.updateMany({
    where: { id: shiftId, status: "ABIERTO" },
    data: { status: "CERRADO", openKey: null, closedById: input.userId, closedAt: new Date() },
  });

  if (reclamado.count === 0) {
    const existe = await tx.cashShift.findUnique({ where: { id: shiftId }, select: { id: true } });
    if (!existe) throw new Error("SHIFT_NOT_FOUND");
    throw new ShiftAlreadyClosedError();
  }

  const esperado = await expectedCash(tx, shiftId);

  return tx.cashShift.update({
    where: { id: shiftId },
    data: {
      expectedAmount: esperado,
      countedAmount,
      difference: round2(countedAmount - esperado),
      closingNotes: input.notes || null,
    },
  });
}

export type ShiftTotals = {
  /** Cobrado dentro del turno, por medio de pago. */
  porMedio: Record<string, number>;
  /** Solo efectivo: lo que debería estar en el cajón además del fondo. */
  efectivo: number;
  /** Total cobrado en el turno, todos los medios. */
  total: number;
  /** Ventas registradas durante el turno. */
  ventas: number;
};

/** Resumen de lo que pasó en un turno. Lectura pura, no escribe nada. */
export async function shiftTotals(tx: Tx, shiftId: string): Promise<ShiftTotals> {
  const porMetodo = await tx.payment.groupBy({
    by: ["method"],
    where: { shiftId },
    _sum: { amount: true },
  });

  const porMedio: Record<string, number> = {};
  let total = 0;
  for (const fila of porMetodo) {
    const monto = round2(toNumber(fila._sum?.amount ?? 0));
    porMedio[fila.method] = monto;
    total = round2(total + monto);
  }

  const ventas = await tx.sale.count({ where: { shiftId } });

  return { porMedio, efectivo: porMedio.EFECTIVO ?? 0, total, ventas };
}

export const shiftStatusLabels = {
  ABIERTO: "Abierto",
  CERRADO: "Cerrado",
} as const;

export const shiftStatusTone: Record<"ABIERTO" | "CERRADO", "neutral" | "good" | "warn" | "critical"> = {
  ABIERTO: "good",
  CERRADO: "neutral",
};

/**
 * Cómo se lee una diferencia de arqueo.
 *
 * Cero es "cuadra". Positivo es sobrante y negativo faltante, y ninguno de los
 * dos es necesariamente un robo: un vuelto mal dado deja sobrante igual que un
 * cobro no registrado. Por eso el cierre tiene nota.
 */
export function differenceLabel(difference: Numeric): string {
  const n = round2(difference);
  if (n === 0) return "Cuadra";
  return n > 0 ? "Sobrante" : "Faltante";
}

export function differenceTone(difference: Numeric): "good" | "warn" | "critical" {
  const n = round2(difference);
  if (n === 0) return "good";
  return n > 0 ? "warn" : "critical";
}
