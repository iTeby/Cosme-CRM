// Fuente única de la máquina de estados de una compra, más las etiquetas y
// colores que usan las vistas. La API de cambio de estado importa
// canTransitionPurchase() desde acá: el mapa no se repite en ningún otro archivo.
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

// ANULADA es un estado final; RECIBIDA solo puede pasar a ANULADA, para
// corregir una recepción registrada por error.
export const purchaseStatusTransitions: Record<PurchaseStatus, PurchaseStatus[]> = {
  PENDIENTE: ["RECIBIDA", "ANULADA"],
  RECIBIDA: ["ANULADA"],
  ANULADA: [],
};

export function canTransitionPurchase(from: PurchaseStatus, to: PurchaseStatus): boolean {
  return (purchaseStatusTransitions[from] ?? []).includes(to);
}
