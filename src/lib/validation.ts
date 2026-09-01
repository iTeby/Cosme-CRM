import { z } from "zod";

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
  category: z.string().trim().max(80).optional().or(z.literal("")),
  variants: z.array(variantInputSchema).min(1, "Agrega al menos una variante/SKU"),
});

export const productUpdateSchema = z.object({
  name: z.string().trim().min(2, "El nombre es muy corto").max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  category: z.string().trim().max(80).optional().or(z.literal("")),
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

export const stockMovementSchema = z.object({
  variantId: z.string().min(1, "Selecciona un producto"),
  warehouseId: z.string().min(1, "Selecciona una bodega"),
  type: z.enum(["ENTRADA", "SALIDA", "AJUSTE"]),
  quantity: z.coerce.number().int().refine((n) => n !== 0, "La cantidad no puede ser 0"),
  reason: z.string().trim().max(200).optional().or(z.literal("")),
});
