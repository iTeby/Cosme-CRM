import type { Prisma } from "@prisma/client";
import { round2, toNumber, type Numeric } from "./decimal";
import { outstanding } from "./sales";
import { claimShiftForCashById } from "./cash";

// Pagos y fiado.
//
// El almacén fía: la venta se lleva hoy y se paga el viernes, a veces en
// partes. Payment es el historial de lo que entró y Sale.paidAmount su suma,
// el mismo patrón que StockMovement y StockLevel: la fila manda, el snapshot
// se mantiene en la misma transacción, y el incremento lo hace Postgres para
// que dos cobros simultáneos no se pisen.
//
// Este módulo es la única puerta de escritura de pagos.

export type Tx = Prisma.TransactionClient;

export type PaymentMethod = "EFECTIVO" | "DEBITO" | "CREDITO" | "TRANSFERENCIA";

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  EFECTIVO: "Efectivo",
  DEBITO: "Débito",
  CREDITO: "Crédito",
  TRANSFERENCIA: "Transferencia",
};

export const paymentMethods = [
  "EFECTIVO",
  "DEBITO",
  "CREDITO",
  "TRANSFERENCIA",
] as const;

/** El abono deja la venta pagada de más. */
export class OverpaymentError extends Error {
  readonly saleNumber?: number;
  readonly excess?: number;
  constructor(saleNumber?: number, excess?: number) {
    super("OVERPAYMENT");
    this.name = "OverpaymentError";
    this.saleNumber = saleNumber;
    this.excess = excess;
  }
}

/** Alguien más cobró al mismo cliente mientras se repartía este abono. */
export class ConcurrentPaymentError extends Error {
  constructor() {
    super("CONCURRENT_PAYMENT");
    this.name = "ConcurrentPaymentError";
  }
}

/** El cliente no tiene ninguna venta con saldo. */
export class NothingToPayError extends Error {
  constructor() {
    super("NOTHING_TO_PAY");
    this.name = "NothingToPayError";
  }
}

export type PaymentInput = {
  amount: Numeric;
  method: PaymentMethod;
  userId: string;
  notes?: string | null;
  /**
   * Turno de caja al que entra la plata. Lo resuelve quien llama, dentro de la
   * misma transacción, con claimOpenShiftForCash() de src/lib/cash.ts.
   *
   * Obligatorio para EFECTIVO y solo para EFECTIVO: la tarjeta y la
   * transferencia no pasan por el cajón, así que no hay nada que cuadrar. Un
   * pago en efectivo sin turno, en cambio, es plata que entró y que ningún
   * arqueo va a poder explicar.
   */
  shiftId?: string | null;
};

/** Se intentó registrar efectivo sin turno de caja abierto. */
export class CashWithoutShiftError extends Error {
  constructor() {
    super("CASH_WITHOUT_SHIFT");
    this.name = "CashWithoutShiftError";
  }
}

/** El abono en efectivo pertenece a un turno ya arqueado. */
export class ShiftClosedError extends Error {
  constructor() {
    super("SHIFT_CLOSED");
    this.name = "ShiftClosedError";
  }
}

/**
 * Abona a una venta concreta.
 *
 * El snapshot se incrementa de forma atómica y se valida después: si el abono
 * deja la venta pagada de más, se lanza y la transacción revierte todo. Leer,
 * sumar en memoria y escribir permitiría que dos cobros simultáneos sobre la
 * misma venta se pisaran, y ahí el saldo por cobrar dejaría de ser confiable.
 */
export async function payOneSale(tx: Tx, saleId: string, input: PaymentInput) {
  const amount = round2(input.amount);
  if (amount <= 0) throw new Error("INVALID_AMOUNT");

  // El efectivo reclama el turno acá, no en la ruta: comprobar solo que
  // `shiftId` viniera dejaba pasar el id de un turno ya cerrado, y esa plata
  // no entra en ningún arqueo —el de ayer está congelado y el de hoy no la
  // conoce—, o sea desaparece en silencio. Reclamar toma además el lock que
  // serializa este cobro contra el cierre.
  if (input.method === "EFECTIVO") {
    if (!input.shiftId) throw new CashWithoutShiftError();
    if (!(await claimShiftForCashById(tx, input.shiftId))) throw new ShiftClosedError();
  }

  // La condición "no está anulada" va DENTRO del WHERE de la escritura, no en
  // una lectura previa. Leerla aparte dejaba una ventana: una anulación que
  // entrara entremedio commiteaba, y este incremento caía sobre una venta ya
  // muerta — plata cobrada contra un documento anulado, y como el reporte de
  // deuda excluye las anuladas, esos pesos desaparecían sin dejar rastro.
  const reclamada = await tx.sale.updateMany({
    where: { id: saleId, status: { not: "ANULADA" } },
    data: { paidAmount: { increment: amount } },
  });

  if (reclamada.count === 0) {
    const existe = await tx.sale.findUnique({ where: { id: saleId }, select: { id: true } });
    throw new Error(existe ? "SALE_VOIDED" : "SALE_NOT_FOUND");
  }

  const actualizada = await tx.sale.findUniqueOrThrow({
    where: { id: saleId },
    select: { paidAmount: true, totalAmount: true, number: true, customerId: true },
  });

  const exceso = round2(toNumber(actualizada.paidAmount) - toNumber(actualizada.totalAmount));
  if (exceso > 0) throw new OverpaymentError(actualizada.number, exceso);

  return tx.payment.create({
    data: {
      customerId: actualizada.customerId,
      saleId,
      amount,
      method: input.method,
      notes: input.notes || null,
      shiftId: input.shiftId ?? null,
      createdById: input.userId,
    },
  });
}

/**
 * Abono a cuenta: la persona deja plata sin decir contra qué venta.
 *
 * Se reparte de la venta más antigua a la más nueva, que es como funciona una
 * libreta de fiados, generando un pago por cada venta que toca. Así todo abono
 * queda atribuido a algo y paidAmount nunca se despega de la suma de pagos.
 *
 * Si sobra plata después de cubrir toda la deuda, se rechaza entero en vez de
 * dejar un saldo a favor colgando: un abono mayor a la deuda casi siempre es
 * un dedazo, y guardarlo sin que nadie lo vea es peor que devolverlo.
 */
export async function payAccount(tx: Tx, customerId: string, input: PaymentInput) {
  const amount = round2(input.amount);
  if (amount <= 0) throw new Error("INVALID_AMOUNT");

  const ventas = await tx.sale.findMany({
    where: { customerId, status: { not: "ANULADA" } },
    // Desempate por número: dos ventas del mismo milisegundo se ordenarían
    // arbitrariamente y el reparto cambiaría entre un intento y otro.
    orderBy: [{ createdAt: "asc" }, { number: "asc" }],
    select: { id: true, totalAmount: true, paidAmount: true },
  });

  const deudaTotal = round2(
    ventas.reduce((acc, v) => acc + outstanding(v.totalAmount, v.paidAmount), 0)
  );
  if (deudaTotal <= 0) throw new NothingToPayError();

  // Se distingue el error del usuario de la carrera. Si el monto supera la
  // deuda que se acaba de leer, es un dedazo y se dice así. Si cabía pero un
  // abono individual se pasa, es que alguien cobró al mismo cliente entremedio:
  // la transacción revierte y hay que reintentar, que no es lo mismo.
  if (amount > deudaTotal) throw new OverpaymentError(undefined, round2(amount - deudaTotal));

  let restante = amount;
  const pagos = [];

  try {
    for (const venta of ventas) {
      if (restante <= 0) break;
      const saldo = outstanding(venta.totalAmount, venta.paidAmount);
      if (saldo <= 0) continue;

      const abono = round2(Math.min(restante, saldo));
      pagos.push(await payOneSale(tx, venta.id, { ...input, amount: abono }));
      restante = round2(restante - abono);
    }
  } catch (err) {
    if (err instanceof OverpaymentError) throw new ConcurrentPaymentError();
    throw err;
  }

  if (restante > 0) throw new ConcurrentPaymentError();

  return pagos;
}

/** Deshace un pago mal registrado y devuelve el saldo a la venta. */
export async function removePayment(tx: Tx, paymentId: string) {
  const pago = await tx.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      saleId: true,
      amount: true,
      method: true,
      shift: { select: { id: true, status: true, number: true } },
    },
  });
  if (!pago) throw new Error("PAYMENT_NOT_FOUND");

  // Un abono en efectivo de un turno ya cerrado es plata que alguien contó a
  // mano y firmó. Borrarlo dejaría el arqueo de ese día diciendo una cifra que
  // ya no se puede reconstruir desde los pagos. Mientras el turno siga
  // abierto sí se puede deshacer: todavía no se contó nada.
  //
  // La pregunta se hace reclamando el turno, no leyendo su estado: el reclamo
  // toma el lock de la fila, así que un cierre que entre a la vez o espera a
  // que esto termine (y entonces cuenta bien) o ya commiteó (y entonces este
  // reclamo falla). Leer el estado y borrar después dejaría la ventana donde
  // el cierre congela un esperado que incluye un pago que está por
  // desaparecer.
  if (pago.method === "EFECTIVO" && pago.shift) {
    const sigueAbierto = await claimShiftForCashById(tx, pago.shift.id);
    if (!sigueAbierto) throw new ShiftClosedError();
  }

  if (pago.saleId) {
    const actualizada = await tx.sale.update({
      where: { id: pago.saleId },
      data: { paidAmount: { decrement: round2(pago.amount) } },
      select: { paidAmount: true },
    });
    // No debería poder pasar, pero si pasara significaría que el snapshot y el
    // historial ya estaban desalineados, y eso no se tapa: se revierte.
    if (round2(actualizada.paidAmount) < 0) throw new Error("NEGATIVE_PAID_AMOUNT");
  }

  await tx.payment.delete({ where: { id: paymentId } });
}
