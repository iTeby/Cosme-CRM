// Helpers compartidos por las vistas de Ventas: etiquetas en español y el
// color de badge para cada estado, más el mapa de transiciones permitidas
// (debe reflejar exactamente el mismo mapa que usa la API en
// src/app/api/sales/[id]/status/route.ts).
export type SaleStatus = "PENDIENTE" | "PAGADA" | "ENTREGADA" | "ANULADA";

export const saleStatusLabels: Record<SaleStatus, string> = {
  PENDIENTE: "Pendiente",
  PAGADA: "Pagada",
  ENTREGADA: "Entregada",
  ANULADA: "Anulada",
};

export const saleStatusTone: Record<SaleStatus, "neutral" | "good" | "warn" | "critical"> = {
  PENDIENTE: "warn",
  PAGADA: "neutral",
  ENTREGADA: "good",
  ANULADA: "critical",
};

export const saleStatusTransitions: Record<SaleStatus, SaleStatus[]> = {
  PENDIENTE: ["PAGADA", "ANULADA"],
  PAGADA: ["ENTREGADA", "ANULADA"],
  ENTREGADA: [],
  ANULADA: [],
};
