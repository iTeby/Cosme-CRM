import { round2, toNumber, type Numeric } from "./decimal";

// Factura emitida en el SII. El CRM no la emite: guarda folio, montos y PDF.
export const IVA_RATE = 0.19;

export function taxFor(net: Numeric): number {
  return round2(toNumber(net) * IVA_RATE);
}

export type InvoiceDisplayState = "EMITIDA" | "PAGADA" | "ANULADA";

export const invoiceStateLabels: Record<InvoiceDisplayState, string> = {
  EMITIDA: "Emitida",
  PAGADA: "Pagada",
  ANULADA: "Anulada",
};

export const invoiceStateTone: Record<InvoiceDisplayState, "neutral" | "good" | "warn" | "critical"> = {
  EMITIDA: "warn",
  PAGADA: "good",
  ANULADA: "critical",
};

/** El estado de pago de una factura se lee de la venta a la que pertenece. */
export function invoiceDisplayState(
  status: "EMITIDA" | "ANULADA",
  saleTotal: Numeric,
  salePaid: Numeric
): InvoiceDisplayState {
  if (status === "ANULADA") return "ANULADA";
  return toNumber(salePaid) >= toNumber(saleTotal) && toNumber(saleTotal) > 0 ? "PAGADA" : "EMITIDA";
}
