// Helpers compartidos por las vistas de Compras: etiquetas en español y el
// color de badge para cada estado, más el mapa de transiciones permitidas
// (debe reflejar exactamente el mismo mapa que usa la API en
// src/app/api/purchases/[id]/status/route.ts).
export type PurchaseStatus = "PENDIENTE" | "RECIBIDA" | "ANULADA";

export const purchaseStatusLabels: Record<PurchaseStatus, string> = {
  PENDIENTE: "Pendiente",
  RECIBIDA: "Recibida",
  ANULADA: "Anulada",
};

export const purchaseStatusTone: Record<PurchaseStatus, "neutral" | "good" | "warn" | "critical"> = {
  PENDIENTE: "warn",
  RECIBIDA: "good",
  ANULADA: "critical",
};

export const purchaseStatusTransitions: Record<PurchaseStatus, PurchaseStatus[]> = {
  PENDIENTE: ["RECIBIDA", "ANULADA"],
  RECIBIDA: ["ANULADA"],
  ANULADA: [],
};
