import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/**
 * Montos en pesos. Se muestran sin decimales, que es como se escribe el peso
 * chileno, salvo cuando el monto los tiene de verdad: una venta por peso
 * (0,75 kg x $3.990 = $2.992,5) deja saldos con centavos, y redondearlos a la
 * vista haría que el saldo mostrado no fuera el saldo que el sistema cobra.
 * Un "$1" en pantalla que en realidad son $0,50 es un saldo que nadie puede
 * cerrar.
 */
export function formatCurrency(value: number | string) {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(n)) return "—";
  const decimales = Number.isInteger(n) ? 0 : 2;
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(n);
}

/**
 * Fechas siempre en hora de Chile.
 *
 * Sin `timeZone`, el servidor formatea con la zona del proceso —UTC en
 * Vercel— y el navegador con la del usuario. La hora cambiaba al hidratar, y
 * en una pantalla cuyo objeto es dejar constancia de a qué hora se contó la
 * caja, eso no es un detalle visual: es un dato mal escrito.
 */
export function formatDate(date: Date | string) {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Santiago",
  }).format(d);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("es-CL").format(value);
}
