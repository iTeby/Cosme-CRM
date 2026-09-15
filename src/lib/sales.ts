import { round2, toNumber, type Numeric } from "./decimal";

// Fuente única de la máquina de estados de una venta y de cómo se lee lo
// pagado. La API de cambio de estado importa canTransitionSale() desde acá:
// el mapa no se repite en ningún otro archivo.
//
// Una venta tiene DOS ejes independientes y hasta ahora compartían un campo:
//   - la entrega, que es este enum
//   - el pago, que se deriva de los abonos y nunca se marca a mano
//
// Con fiado los dos son ciertos por separado y en cualquier orden: la
// mercadería sale el lunes y se paga el viernes. Por eso PAGADA dejó de ser un
// estado de entrega.
export type SaleStatus = "PENDIENTE" | "ENTREGADA" | "ANULADA";

export const saleStatusLabels: Record<SaleStatus, string> = {
  PENDIENTE: "Por entregar",
  ENTREGADA: "Entregada",
  ANULADA: "Anulada",
};

export const saleStatusTone: Record<SaleStatus, "neutral" | "good" | "warn" | "critical"> = {
  PENDIENTE: "warn",
  ENTREGADA: "good",
  ANULADA: "critical",
};

// ANULADA es final. Una venta entregada todavía se puede anular —mercadería
// devuelta—, pero solo si no tiene pagos registrados: esa regla vive en la
// ruta, porque necesita consultar los abonos.
export const saleStatusTransitions: Record<SaleStatus, SaleStatus[]> = {
  PENDIENTE: ["ENTREGADA", "ANULADA"],
  ENTREGADA: ["ANULADA"],
  ANULADA: [],
};

export function canTransitionSale(from: SaleStatus, to: SaleStatus): boolean {
  return (saleStatusTransitions[from] ?? []).includes(to);
}

// --- El eje del pago, derivado ---

export type PaymentState = "IMPAGA" | "PARCIAL" | "PAGADA";

export const paymentStateLabels: Record<PaymentState, string> = {
  IMPAGA: "Impaga",
  PARCIAL: "Abonada",
  PAGADA: "Pagada",
};

export const paymentStateTone: Record<PaymentState, "neutral" | "good" | "warn" | "critical"> = {
  IMPAGA: "critical",
  PARCIAL: "warn",
  PAGADA: "good",
};

/** Lo que falta por cobrar de una venta. Nunca negativo. */
export function outstanding(total: Numeric, paid: Numeric): number {
  return Math.max(0, round2(toNumber(total) - toNumber(paid)));
}

/**
 * Estado de pago de una venta. Es una consecuencia de los abonos, no una
 * decisión: nadie puede marcar una venta como pagada sin que entre la plata.
 */
export function paymentStateOf(total: Numeric, paid: Numeric): PaymentState {
  const abonado = round2(paid);
  if (abonado <= 0) return "IMPAGA";
  return outstanding(total, paid) <= 0 ? "PAGADA" : "PARCIAL";
}
