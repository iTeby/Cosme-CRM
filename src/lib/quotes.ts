import { toNumber, type Numeric } from "./decimal";

// Cotización: estados y moneda. Una cotización nunca toca stock; al aceptarse
// se convierte en venta (ver /api/quotes/[id]/convert) y queda ligada a ella.
export const QUOTE_STATUSES = ["BORRADOR", "ENVIADA", "ACEPTADA", "RECHAZADA"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const quoteStatusLabels: Record<QuoteStatus, string> = {
  BORRADOR: "Borrador",
  ENVIADA: "Enviada",
  ACEPTADA: "Aceptada",
  RECHAZADA: "Rechazada",
};

export const quoteStatusTone: Record<QuoteStatus, "neutral" | "good" | "warn" | "critical"> = {
  BORRADOR: "neutral",
  ENVIADA: "warn",
  ACEPTADA: "good",
  RECHAZADA: "critical",
};

export const CURRENCIES = ["CLP", "UF"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const currencyLabels: Record<Currency, string> = { CLP: "Pesos (CLP)", UF: "UF" };

/** Una cotización enviada cuya validez ya pasó se muestra vencida, sin cambiar de estado. */
export function isExpired(status: QuoteStatus, validUntil: string | Date, now = new Date()): boolean {
  return status === "ENVIADA" && new Date(validUntil).getTime() < now.getTime();
}

export function formatQuoteAmount(amount: Numeric, currency: Currency): string {
  const n = toNumber(amount);
  if (currency === "UF") {
    return `${new Intl.NumberFormat("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} UF`;
  }
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n);
}
