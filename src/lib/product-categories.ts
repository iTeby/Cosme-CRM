// Lista curada de categorías de producto. Es el único lugar que hay que
// tocar para agregar/quitar una categoría — se usa tanto en el desplegable
// de Producto (crear/editar) como en la validación del backend.
export const PRODUCT_CATEGORIES = [
  "Limpieza",
  "Cuidado Personal",
  "Artículos de Oficina",
  "Electrónica y Tecnología",
  "Electrodomésticos",
  "Hogar y Cocina",
  "Herramientas",
  "Seguridad y Protección",
  "Deporte y Aire Libre",
  "Accesorios y Viaje",
  "Otros",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
