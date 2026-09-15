// Suscripción anual. ACTIVA con renewsAt pasado se muestra "Vencida" sin
// cambiar el estado guardado: la fecha manda.
export type SubscriptionStatus = "ACTIVA" | "CANCELADA";
export type SubscriptionDisplayState = "ACTIVA" | "POR_RENOVAR" | "VENCIDA" | "CANCELADA";

export const RENEWAL_WARNING_DAYS = 60;

export function subscriptionDisplayState(
  status: SubscriptionStatus,
  renewsAt: string | Date,
  now = new Date()
): SubscriptionDisplayState {
  if (status === "CANCELADA") return "CANCELADA";
  const dias = daysUntil(renewsAt, now);
  if (dias < 0) return "VENCIDA";
  if (dias <= RENEWAL_WARNING_DAYS) return "POR_RENOVAR";
  return "ACTIVA";
}

export const subscriptionStateLabels: Record<SubscriptionDisplayState, string> = {
  ACTIVA: "Activa",
  POR_RENOVAR: "Por renovar",
  VENCIDA: "Vencida",
  CANCELADA: "Cancelada",
};

export const subscriptionStateTone: Record<SubscriptionDisplayState, "neutral" | "good" | "warn" | "critical"> = {
  ACTIVA: "good",
  POR_RENOVAR: "warn",
  VENCIDA: "critical",
  CANCELADA: "neutral",
};

export function daysUntil(date: string | Date, now = new Date()): number {
  const ms = new Date(date).getTime() - now.getTime();
  return Math.ceil(ms / 86_400_000);
}

export function addOneYear(date: string | Date): Date {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + 1);
  return d;
}
