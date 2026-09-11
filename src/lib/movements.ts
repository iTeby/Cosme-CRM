// Fuente única de los tipos de movimiento de inventario: etiquetas, colores y
// qué puede registrarse a mano.
//
// Seis tipos. Tres nacieron con el proyecto y tres entran con el rubro
// panadería: la harina sale con CONSUMO hacia una producción, el pan entra con
// PRODUCCION desde esa misma producción, y lo que no se vendió sale con MERMA.
// Esa cadena es la que permite seguir la ruta del pan y los insumos de punta a
// punta leyendo solo stock_movements.
export type MovementType =
  | "ENTRADA"
  | "SALIDA"
  | "AJUSTE"
  | "MERMA"
  | "CONSUMO"
  | "PRODUCCION";

export const movementTypeLabels: Record<MovementType, string> = {
  ENTRADA: "Entrada",
  SALIDA: "Salida",
  AJUSTE: "Ajuste",
  MERMA: "Merma",
  CONSUMO: "Consumo de insumo",
  PRODUCCION: "Producción",
};

export const movementTypeTone: Record<
  MovementType,
  "neutral" | "good" | "warn" | "critical"
> = {
  ENTRADA: "good",
  SALIDA: "critical",
  AJUSTE: "neutral",
  MERMA: "warn",
  CONSUMO: "neutral",
  PRODUCCION: "good",
};

/**
 * Los que un usuario puede registrar a mano desde Inventario.
 *
 * CONSUMO y PRODUCCION quedan fuera a propósito: los genera el módulo de
 * producción a partir de una receta, igual que una venta genera su SALIDA.
 * Permitir registrarlos sueltos rompería la trazabilidad, porque quedarían
 * movimientos de producción sin producción que los explique.
 */
export const manualMovementTypes = ["ENTRADA", "SALIDA", "AJUSTE", "MERMA"] as const;

export type ManualMovementType = (typeof manualMovementTypes)[number];

/** Etiqueta del desplegable: AJUSTE admite negativo, y conviene decirlo. */
export const manualMovementLabels: Record<ManualMovementType, string> = {
  ENTRADA: "Entrada",
  SALIDA: "Salida",
  AJUSTE: "Ajuste (+/-)",
  MERMA: "Merma",
};
