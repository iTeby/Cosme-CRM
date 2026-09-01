import { z } from "zod";
import { PRODUCT_CATEGORIES } from "@/lib/product-categories";

// Se mantiene opcional (no todo producto tiene categoría asignada, p.ej. los
// importados por Excel), pero si se envía un valor debe ser uno de la lista
// curada — así el desplegable y el backend nunca se desincronizan.
const categorySchema = z
  .enum(PRODUCT_CATEGORIES)
  .optional()
  .or(z.literal(""));

export const variantInputSchema = z.object({
  sku: z.string().trim().min(2, "SKU muy corto").max(60),
  attributes: z.string().trim().max(200).optional().or(z.literal("")),
  price: z.coerce.number().min(0, "El precio no puede ser negativo"),
  cost: z.coerce.number().min(0, "El costo no puede ser negativo"),
  lowStockThreshold: z.coerce.number().int().min(0).default(5),
  initialQuantity: z.coerce.number().int().min(0).default(0),
});

export const productCreateSchema = z.object({
  name: z.string().trim().min(2, "El nombre es muy corto").max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  category: categorySchema,
  variants: z.array(variantInputSchema).min(1, "Agrega al menos una variante/SKU"),
});

export const productUpdateSchema = z.object({
  name: z.string().trim().min(2, "El nombre es muy corto").max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  category: categorySchema,
  active: z.boolean(),
});

export const variantUpdateSchema = z.object({
  sku: z.string().trim().min(2, "SKU muy corto").max(60),
  attributes: z.string().trim().max(200).optional().or(z.literal("")),
  price: z.coerce.number().min(0),
  cost: z.coerce.number().min(0),
  lowStockThreshold: z.coerce.number().int().min(0),
  active: z.boolean(),
});

export const variantAddSchema = variantInputSchema;

export const userCreateSchema = z.object({
  name: z.string().trim().min(2, "El nombre es muy corto").max(120),
  email: z.string().trim().toLowerCase().email("Correo inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(72),
  role: z.enum(["ADMIN", "VENTAS", "BODEGA", "COMPRAS"]),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(2, "El nombre es muy corto").max(120),
  role: z.enum(["ADMIN", "VENTAS", "BODEGA", "COMPRAS"]),
  active: z.boolean(),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres")
    .max(72)
    .optional()
    .or(z.literal("")),
});

export const customerCreateSchema = z.object({
  name: z.string().trim().min(2, "El nombre es muy corto").max(120),
  taxId: z.string().trim().max(20).optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  email: z.string().trim().toLowerCase().max(160).optional().or(z.literal("")),
  address: z.string().trim().max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export const customerUpdateSchema = customerCreateSchema.extend({
  active: z.boolean(),
});

export const saleItemInputSchema = z.object({
  variantId: z.string().min(1, "Selecciona un producto"),
  quantity: z.coerce.number().int().min(1, "La cantidad debe ser al menos 1"),
  unitPrice: z.coerce.number().min(0, "El precio no puede ser negativo"),
});

export const saleCreateSchema = z.object({
  customerId: z.string().min(1, "Selecciona un cliente"),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  items: z.array(saleItemInputSchema).min(1, "Agrega al menos un producto"),
});

export const saleStatusUpdateSchema = z.object({
  status: z.enum(["PENDIENTE", "PAGADA", "ENTREGADA", "ANULADA"]),
});

export const supplierCreateSchema = z.object({
  name: z.string().trim().min(2, "El nombre es muy corto").max(120),
  taxId: z.string().trim().max(20).optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  email: z.string().trim().toLowerCase().max(160).optional().or(z.literal("")),
  address: z.string().trim().max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export const supplierUpdateSchema = supplierCreateSchema.extend({
  active: z.boolean(),
});

export const purchaseItemInputSchema = z.object({
  variantId: z.string().min(1, "Selecciona un producto"),
  quantity: z.coerce.number().int().min(1, "La cantidad debe ser al menos 1"),
  unitCost: z.coerce.number().min(0, "El costo no puede ser negativo"),
});

export const purchaseCreateSchema = z.object({
  supplierId: z.string().min(1, "Selecciona un proveedor"),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  items: z.array(purchaseItemInputSchema).min(1, "Agrega al menos un producto"),
});

export const purchaseStatusUpdateSchema = z.object({
  status: z.enum(["PENDIENTE", "RECIBIDA", "ANULADA"]),
});

export const productImportRowSchema = z.object({
  rowNumber: z.number().int(),
  sku: z.string().trim().min(1, "SKU vacío").max(60, "SKU muy largo"),
  name: z.string().trim().min(1, "Nombre vacío").max(120, "Nombre muy largo"),
  qty: z.coerce
    .number({ invalid_type_error: "Cantidad inválida" })
    .int("La cantidad debe ser un número entero")
    .min(0, "La cantidad no puede ser negativa"),
  warehouseName: z.string().trim().min(1, "Bodega vacía").max(80, "Nombre de bodega muy largo"),
  price: z.coerce
    .number({ invalid_type_error: "Valor inválido" })
    .min(0, "El valor no puede ser negativo"),
});

export const productImportCommitSchema = z.object({
  rows: z
    .array(productImportRowSchema)
    .min(1, "No hay filas válidas para importar")
    .max(5000, "Demasiadas filas para importar de una vez"),
});

export const stockMovementSchema = z.object({
  variantId: z.string().min(1, "Selecciona un producto"),
  warehouseId: z.string().min(1, "Selecciona una bodega"),
  type: z.enum(["ENTRADA", "SALIDA", "AJUSTE"]),
  quantity: z.coerce.number().int().refine((n) => n !== 0, "La cantidad no puede ser 0"),
  reason: z.string().trim().max(200).optional().or(z.literal("")),
});

// Edición de un movimiento ya registrado: a diferencia de la creación, no
// se permite mover el movimiento a otro producto/bodega (eso equivale a
// borrar y crear uno nuevo) — solo se puede corregir tipo, cantidad y motivo.
export const stockMovementUpdateSchema = z.object({
  type: z.enum(["ENTRADA", "SALIDA", "AJUSTE"]),
  quantity: z.coerce.number().int().refine((n) => n !== 0, "La cantidad no puede ser 0"),
  reason: z.string().trim().max(200).optional().or(z.literal("")),
});
