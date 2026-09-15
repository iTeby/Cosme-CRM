import { z } from "zod";
import { PRODUCT_CATEGORIES } from "@/lib/product-categories";
import { PRICING_TYPES } from "@/lib/pricing-types";
import { CUSTOMER_STAGES, LEAD_SOURCES } from "@/lib/customers";
import { CURRENCIES } from "@/lib/quotes";
import { manualMovementTypes } from "@/lib/movements";
import { paymentMethods } from "@/lib/payments";

// Toda cantidad y todo monto pasa por acá. Sin .finite() y sin tope, zod acepta
// "1e30" e "Infinity": el primero llega a Postgres y revienta con un overflow
// de numeric que el catch genérico reporta como 500, y el segundo lo convierte
// toNumber() en 0 sin avisar, así que se escribe un movimiento distinto al
// pedido. El tope es holgado para un almacén y angosto para un dedazo.
const MAX_CANTIDAD = 1_000_000;
const MAX_LINEAS = 200;

const cantidadPositiva = (mensaje: string) =>
  z.coerce.number().finite("Cantidad inválida").positive(mensaje).max(MAX_CANTIDAD, "Cantidad demasiado grande");

const cantidadNoNegativa = (mensaje: string) =>
  z.coerce.number().finite("Cantidad inválida").min(0, mensaje).max(MAX_CANTIDAD, "Cantidad demasiado grande");

const montoPositivo = (mensaje: string) =>
  z.coerce
    .number()
    .finite("Monto inválido")
    .positive(mensaje)
    .max(9_999_999_999, "Monto demasiado grande");

const monto = (mensaje: string) =>
  z.coerce.number().finite("Valor inválido").min(0, mensaje).max(9_999_999_999, "Valor demasiado grande");

// Se mantiene opcional (no todo producto tiene categoría asignada, p.ej. los
// importados por Excel), pero si se envía un valor debe ser uno de la lista
// curada — así el desplegable y el backend nunca se desincronizan.
const categorySchema = z
  .enum(PRODUCT_CATEGORIES)
  .optional()
  .or(z.literal(""));

const pricingTypeSchema = z.enum(PRICING_TYPES).default("FIJO");

// Enlace público del producto: la página del servicio o el demo en vivo.
const urlSchema = z
  .string()
  .trim()
  .url("El enlace no es válido")
  .max(300)
  .optional()
  .or(z.literal(""));

// El código impreso en el envase, el que lee la pistola. No es el SKU.
// Se acepta vacío (mucho producto de almacén se vende a granel y no tiene
// código); quien escriba debe convertir "" en null, porque dos cadenas vacías
// sí colisionan en el índice único y dos NULL no.
// Los plazos de vencimiento son días enteros y opcionales: no hay un número
// correcto para todo el almacén, así que no se inventa uno por defecto.
const diasOpcionales = (mensaje: string) =>
  z.coerce
    .number()
    .int(mensaje)
    .min(1, mensaje)
    .max(3650, "El plazo es demasiado largo")
    .optional()
    .or(z.literal("").transform(() => undefined))
    .or(z.null().transform(() => undefined));

const barcodeSchema = z
  .string()
  .trim()
  .max(32, "El código de barras es muy largo")
  .regex(/^[A-Za-z0-9._-]*$/, "El código de barras solo admite letras, números, punto y guion")
  .optional()
  .or(z.literal(""));

export const variantInputSchema = z.object({
  sku: z.string().trim().min(2, "SKU muy corto").max(60),
  barcode: barcodeSchema,
  tracksLots: z.boolean().optional(),
  shelfLifeDays: diasOpcionales("La vida útil debe ser un número de días"),
  nearExpiryDays: diasOpcionales("El aviso debe ser un número de días"),
  unit: z.string().trim().min(1).max(8).default("UN"),
  attributes: z.string().trim().max(200).optional().or(z.literal("")),
  price: monto("El precio no puede ser negativo"),
  cost: monto("El costo no puede ser negativo"),
  lowStockThreshold: cantidadNoNegativa("El umbral no puede ser negativo").default(5),
  initialQuantity: cantidadNoNegativa("La cantidad no puede ser negativa").default(0),
});

export const productCreateSchema = z.object({
  name: z.string().trim().min(2, "El nombre es muy corto").max(120),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  category: categorySchema,
  pricingType: pricingTypeSchema,
  url: urlSchema,
  variants: z.array(variantInputSchema).min(1, "Agrega al menos una variante/SKU").max(MAX_LINEAS),
});

export const productUpdateSchema = z.object({
  name: z.string().trim().min(2, "El nombre es muy corto").max(120),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  category: categorySchema,
  pricingType: pricingTypeSchema,
  url: urlSchema,
  active: z.boolean(),
});

export const variantUpdateSchema = z.object({
  sku: z.string().trim().min(2, "SKU muy corto").max(60),
  barcode: barcodeSchema,
  tracksLots: z.boolean().optional(),
  shelfLifeDays: diasOpcionales("La vida útil debe ser un número de días"),
  nearExpiryDays: diasOpcionales("El aviso debe ser un número de días"),
  unit: z.string().trim().min(1).max(8).default("UN"),
  attributes: z.string().trim().max(200).optional().or(z.literal("")),
  price: monto("El precio no puede ser negativo"),
  cost: monto("El costo no puede ser negativo"),
  lowStockThreshold: cantidadNoNegativa("El umbral no puede ser negativo"),
  active: z.boolean(),
});

export const variantAddSchema = variantInputSchema;

export const userCreateSchema = z.object({
  name: z.string().trim().min(2, "El nombre es muy corto").max(120),
  email: z.string().trim().toLowerCase().email("Correo inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(72),
  role: z.enum(["ADMIN", "VENTAS", "CAJERO", "BODEGA", "COMPRAS"]),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(2, "El nombre es muy corto").max(120),
  role: z.enum(["ADMIN", "VENTAS", "CAJERO", "BODEGA", "COMPRAS"]),
  active: z.boolean(),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres")
    .max(72)
    .optional()
    .or(z.literal("")),
});

// Fecha opcional que llega como texto desde un <input type="date">.
const fechaOpcional = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? new Date(v) : null))
  .refine((v) => v === null || !Number.isNaN(v.getTime()), "Fecha inválida");

const fechaObligatoria = z
  .string()
  .trim()
  .min(1, "La fecha es obligatoria")
  .transform((v) => new Date(v))
  .refine((v) => !Number.isNaN(v.getTime()), "Fecha inválida");

export const customerCreateSchema = z.object({
  name: z.string().trim().min(2, "El nombre es muy corto").max(120),
  contactName: z.string().trim().max(120).optional().or(z.literal("")),
  stage: z.enum(CUSTOMER_STAGES).default("NUEVO"),
  source: z.enum(LEAD_SOURCES).optional().or(z.literal("")),
  nextContactAt: fechaOpcional,
  taxId: z.string().trim().max(20).optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  email: z.string().trim().toLowerCase().max(160).optional().or(z.literal("")),
  address: z.string().trim().max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const customerUpdateSchema = customerCreateSchema.extend({
  active: z.boolean(),
});

// Respuestas del guion: una por pregunta, texto libre. Vacío = sin responder.
export const qualificationAnswersSchema = z.object({
  answers: z
    .array(z.object({ questionId: z.string().min(1), answer: z.string().trim().max(4000) }))
    .max(50),
});

// --- Cotizaciones ---
export const quoteItemInputSchema = z.object({
  variantId: z.string().min(1, "Selecciona un ítem del catálogo"),
  description: z.string().trim().min(1, "Describe la línea").max(1000),
  quantity: z.coerce.number().positive("La cantidad debe ser mayor que cero").max(999_999),
  unitPrice: monto("El precio no puede ser negativo"),
});

export const quoteCreateSchema = z.object({
  customerId: z.string().min(1, "Selecciona un cliente"),
  currency: z.enum(CURRENCIES).default("CLP"),
  validUntil: fechaObligatoria,
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  items: z.array(quoteItemInputSchema).min(1, "Agrega al menos una línea").max(MAX_LINEAS),
});

export const quoteStatusSchema = z.object({
  status: z.enum(["ENVIADA", "RECHAZADA", "BORRADOR"]),
});

// Convertir en venta: en UF hace falta el valor del día; el crédito de
// Diagnóstico se aplica solo si el usuario lo pide y existe.
export const quoteConvertSchema = z.object({
  purchaseOrder: z.string().trim().max(60).optional().or(z.literal("")),
  ufValue: z.coerce.number().positive().max(1_000_000).optional(),
  applyCredit: z.boolean().default(false),
});

// --- Facturas (emitidas en el SII; acá solo se registran) ---
export const invoiceCreateSchema = z.object({
  saleId: z.string().min(1),
  number: z.string().trim().min(1, "Falta el folio").max(20),
  issuedAt: fechaObligatoria,
  netAmount: z.coerce.number().positive("El neto debe ser mayor que cero").max(9_999_999_999),
  driveUrl: z.string().trim().url("El enlace no es válido").max(500).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export const invoiceUpdateSchema = z.object({
  driveUrl: z.string().trim().url("El enlace no es válido").max(500).optional().or(z.literal("")),
  status: z.enum(["EMITIDA", "ANULADA"]).optional(),
});

// --- Suscripciones ---
export const subscriptionCreateSchema = z.object({
  customerId: z.string().min(1, "Selecciona un cliente"),
  name: z.string().trim().min(2, "El nombre es muy corto").max(120),
  currency: z.enum(CURRENCIES).default("CLP"),
  amount: z.coerce.number().positive("El monto debe ser mayor que cero").max(9_999_999_999),
  startsAt: fechaObligatoria,
  renewsAt: fechaObligatoria,
  hoursIncluded: z.coerce.number().int().min(0).max(10_000).default(0),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  saleId: z.string().optional().or(z.literal("")),
});

export const subscriptionUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  amount: z.coerce.number().positive().max(9_999_999_999),
  renewsAt: fechaObligatoria,
  hoursIncluded: z.coerce.number().int().min(0).max(10_000),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  status: z.enum(["ACTIVA", "CANCELADA"]),
});

export const subscriptionHoursSchema = z.object({
  hours: z.coerce.number().positive("Las horas deben ser mayores que cero").max(1000),
  description: z.string().trim().min(2, "Describe el trabajo").max(500),
});

export const subscriptionRenewSchema = z.object({
  ufValue: z.coerce.number().positive().max(1_000_000).optional(),
});

export const saleItemInputSchema = z.object({
  variantId: z.string().min(1, "Selecciona un producto"),
  quantity: cantidadPositiva("La cantidad debe ser mayor que 0"),
  unitPrice: monto("El precio no puede ser negativo"),
});

export const saleCreateSchema = z.object({
  customerId: z.string().min(1, "Selecciona un cliente"),
  purchaseOrder: z.string().trim().max(60).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  items: z.array(saleItemInputSchema).min(1, "Agrega al menos un producto").max(MAX_LINEAS),
});

export const saleStatusUpdateSchema = z.object({
  status: z.enum(["PENDIENTE", "ENTREGADA", "ANULADA"]),
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
  quantity: cantidadPositiva("La cantidad debe ser mayor que 0"),
  unitCost: monto("El costo no puede ser negativo"),
});

export const purchaseCreateSchema = z.object({
  supplierId: z.string().min(1, "Selecciona un proveedor"),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  items: z.array(purchaseItemInputSchema).min(1, "Agrega al menos un producto").max(MAX_LINEAS),
});

export const purchaseStatusUpdateSchema = z.object({
  status: z.enum(["PENDIENTE", "RECIBIDA", "ANULADA"]),
});

export const productImportRowSchema = z.object({
  rowNumber: z.number().int(),
  sku: z.string().trim().min(1, "SKU vacío").max(60, "SKU muy largo"),
  name: z.string().trim().min(1, "Nombre vacío").max(120, "Nombre muy largo"),
  qty: cantidadNoNegativa("La cantidad no puede ser negativa"),
  warehouseName: z.string().trim().min(1, "Bodega vacía").max(80, "Nombre de bodega muy largo"),
  price: monto("El valor no puede ser negativo"),
});

export const productImportCommitSchema = z.object({
  rows: z
    .array(productImportRowSchema)
    .min(1, "No hay filas válidas para importar")
    // 500 y no 5000: cada fila hace varias consultas seriales a Neon dentro de
    // una sola transacción con timeout de 55 s. Con miles de filas el timeout
    // llega antes que el final y revierte la importación completa.
    .max(500, "Demasiadas filas para importar de una vez. Divide el archivo."),
});

/**
 * Primer mensaje legible de un error de zod.
 *
 * Devolver `error.flatten()` manda un objeto al navegador, y los formularios
 * solo saben mostrar un texto: el usuario termina viendo el mensaje genérico
 * de "no se pudo guardar" y sin idea de qué corregir.
 */
export function primerMensaje(error: z.ZodError): string {
  const flat = error.flatten();
  const deCampo = Object.values(flat.fieldErrors).flat().find(Boolean);
  return flat.formErrors[0] ?? deCampo ?? "Los datos enviados no son válidos";
}

// --- Pagos y fiado ---

export const paymentCreateSchema = z
  .object({
    // Uno de los dos, nunca los dos: o se abona a una venta concreta, o se
    // deja plata a cuenta y el sistema la reparte de la más antigua a la más
    // nueva.
    saleId: z.string().min(1).optional(),
    customerId: z.string().min(1).optional(),
    amount: montoPositivo("El monto debe ser mayor que 0"),
    method: z.enum(paymentMethods),
    notes: z.string().trim().max(300, "La nota es muy larga").optional().or(z.literal("")),
  })
  .refine((p) => Boolean(p.saleId) !== Boolean(p.customerId), {
    message: "Indica una venta o un cliente, no ambos",
    path: ["saleId"],
  });

// --- Recetas y producción ---

export const recipeItemInputSchema = z.object({
  variantId: z.string().min(1, "Selecciona un insumo"),
  quantity: cantidadPositiva("La cantidad debe ser mayor que 0"),
});

export const recipeUpsertSchema = z
  .object({
    yield: cantidadPositiva("El rendimiento debe ser mayor que 0"),
    notes: z.string().trim().max(500).optional().or(z.literal("")),
    active: z.boolean().default(true),
    items: z.array(recipeItemInputSchema).min(1, "Agrega al menos un insumo").max(50),
  })
  .refine(
    (r) => new Set(r.items.map((i) => i.variantId)).size === r.items.length,
    { message: "Hay un insumo repetido en la receta", path: ["items"] }
  );

export const productionItemInputSchema = z.object({
  variantId: z.string().min(1, "Selecciona un producto"),
  quantityProduced: cantidadNoNegativa("La cantidad no puede ser negativa"),
  quantityWasted: cantidadNoNegativa("La merma no puede ser negativa").default(0),
});

export const productionCreateSchema = z
  .object({
    warehouseId: z.string().min(1).optional(),
    // Acotada: el listado ordena por esta fecha, así que un 2099 por dedazo se
    // queda arriba de todo para siempre. Un año atrás cubre correcciones
    // tardías; un día adelante cubre husos horarios.
    producedOn: z.coerce
      .date()
      .min(new Date(Date.now() - 365 * 24 * 3600 * 1000), "La fecha es demasiado antigua")
      .max(new Date(Date.now() + 24 * 3600 * 1000), "La fecha no puede estar en el futuro")
      .optional(),
    notes: z.string().trim().max(500).optional().or(z.literal("")),
    items: z.array(productionItemInputSchema).min(1, "Agrega al menos un producto").max(MAX_LINEAS),
  })
  .refine(
    (p) => new Set(p.items.map((i) => i.variantId)).size === p.items.length,
    { message: "Hay un producto repetido", path: ["items"] }
  )
  .refine(
    (p) => p.items.some((i) => i.quantityProduced > 0 || i.quantityWasted > 0),
    { message: "Registra al menos una cantidad producida o una merma", path: ["items"] }
  );

export const stockMovementSchema = z.object({
  variantId: z.string().min(1, "Selecciona un producto"),
  warehouseId: z.string().min(1, "Selecciona una bodega"),
  type: z.enum(manualMovementTypes),
  quantity: z.coerce
    .number()
    .finite("Cantidad inválida")
    .max(MAX_CANTIDAD, "Cantidad demasiado grande")
    .min(-MAX_CANTIDAD, "Cantidad demasiado grande")
    .refine((n) => n !== 0, "La cantidad no puede ser 0"),
  reason: z.string().trim().max(200).optional().or(z.literal("")),
});

// Edición de un movimiento ya registrado: a diferencia de la creación, no
// se permite mover el movimiento a otro producto/bodega (eso equivale a
// borrar y crear uno nuevo) — solo se puede corregir tipo, cantidad y motivo.
export const stockMovementUpdateSchema = z.object({
  type: z.enum(manualMovementTypes),
  quantity: z.coerce
    .number()
    .finite("Cantidad inválida")
    .max(MAX_CANTIDAD, "Cantidad demasiado grande")
    .min(-MAX_CANTIDAD, "Cantidad demasiado grande")
    .refine((n) => n !== 0, "La cantidad no puede ser 0"),
  reason: z.string().trim().max(200).optional().or(z.literal("")),
});

// --- Caja y turno ---

export const shiftOpenSchema = z.object({
  // El fondo puede ser 0: hay almacenes que parten el día con el cajón vacío.
  openingAmount: monto("El fondo no puede ser negativo"),
  warehouseId: z.string().min(1).optional(),
  notes: z.string().trim().max(300, "La nota es muy larga").optional().or(z.literal("")),
});

export const shiftCloseSchema = z.object({
  // Lo contado a mano. Cero es una respuesta válida y a veces la correcta.
  countedAmount: monto("El monto contado no puede ser negativo"),
  notes: z.string().trim().max(500, "La nota es muy larga").optional().or(z.literal("")),
});

// --- Lotes y vencimiento ---

export const lotReceiveSchema = z.object({
  variantId: z.string().min(1, "Selecciona un producto"),
  warehouseId: z.string().min(1).optional(),
  code: z.string().trim().min(1, "El lote necesita un número").max(60),
  quantity: cantidadPositiva("La cantidad debe ser mayor que 0"),
  // Fecha o vacío: hay productos con lote y sin vencimiento, como una
  // partida de envases que se rastrea por proveedor.
  expiresAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
    .optional()
    .or(z.literal("")),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
});

export const lotStatusSchema = z.object({
  status: z.enum(["DISPONIBLE", "BLOQUEADO", "VENCIDO"]),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
});
