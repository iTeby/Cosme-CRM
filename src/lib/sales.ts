// Fuente única de la máquina de estados de una venta, más las etiquetas y
// colores que usan las vistas. La API de cambio de estado importa
// canTransitionSale() desde acá: el mapa no se repite en ningún otro archivo.
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

// ENTREGADA y ANULADA son estados finales: una vez ahí, la venta ya no cambia.
export const saleStatusTransitions: Record<SaleStatus, SaleStatus[]> = {
  PENDIENTE: ["PAGADA", "ANULADA"],
  PAGADA: ["ENTREGADA", "ANULADA"],
  ENTREGADA: [],
  ANULADA: [],
};

export function canTransitionSale(from: SaleStatus, to: SaleStatus): boolean {
  return (saleStatusTransitions[from] ?? []).includes(to);
}
