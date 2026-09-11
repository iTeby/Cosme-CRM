import type { Prisma } from "@prisma/client";
import { round3, toNumber, type Numeric } from "./decimal";
import type { MovementType } from "./movements";

// Única puerta de escritura del inventario.
//
// Regla del modelo: StockMovement es la fuente de verdad y su historial no se
// reescribe; StockLevel es solo un snapshot que debe ser siempre la suma de los
// movimientos de esa variante+bodega. Mantener las dos cosas sincronizadas es
// responsabilidad exclusiva de este archivo: ninguna ruta de la API debe llamar
// a stockLevel.upsert ni a stockMovement.create por su cuenta.
//
// Convención de signo: StockMovement.quantity guarda el delta YA firmado, no la
// magnitud. Una salida de 3 unidades se guarda como -3. Por eso los llamadores
// que reciben un número crudo del usuario pasan primero por toDelta().
//
// Las cantidades son Decimal en la base y Prisma las devuelve como objeto, no
// como number: sumarlas con + concatena en silencio. Todo lo que entra acá pasa
// por toNumber() antes de tocar la aritmética.

export type Tx = Prisma.TransactionClient;

/** El stock quedaría negativo. Lleva el SKU cuando se conoce, para el mensaje. */
export class InsufficientStockError extends Error {
  readonly sku?: string;
  constructor(sku?: string) {
    super(sku ? `INSUFFICIENT_STOCK:${sku}` : "INSUFFICIENT_STOCK");
    this.name = "InsufficientStockError";
    this.sku = sku;
  }
}

/**
 * Tabla de signos de los seis tipos de movimiento. Cambiar acá cambia el
 * comportamiento en todo el sistema: no hay otra tabla en ningún otro archivo.
 *
 * 0 significa "se aplica tal cual": solo AJUSTE, que admite negativo porque un
 * conteo físico puede dar menos de lo esperado.
 */
const movementSign: Record<MovementType, 1 | -1 | 0> = {
  ENTRADA: 1,
  PRODUCCION: 1,
  SALIDA: -1,
  MERMA: -1,
  CONSUMO: -1,
  AJUSTE: 0,
};

/** Traduce lo que ingresó el usuario al delta con signo que se persiste. */
export function toDelta(type: MovementType, quantity: Numeric): number {
  const n = toNumber(quantity);
  const sign = movementSign[type];
  return sign === 0 ? n : sign * Math.abs(n);
}

/** Stock actual de una variante en una bodega. 0 si nunca tuvo movimientos. */
export async function currentStock(
  tx: Tx,
  variantId: string,
  warehouseId: string
): Promise<number> {
  const level = await tx.stockLevel.findUnique({
    where: { variantId_warehouseId: { variantId, warehouseId } },
  });
  return round3(level?.quantity);
}

/**
 * Suma un delta al snapshot y devuelve el valor resultante.
 *
 * La suma la hace Postgres, no JavaScript. Eso importa: leer el nivel, sumar en
 * memoria y escribir el total es un read-modify-write, y bajo READ COMMITTED
 * —el aislamiento por defecto— nada bloquea entre la lectura y la escritura.
 * Dos ventas simultáneas de 3 sobre un stock de 10 leerían ambas 10, escribirían
 * ambas 7, y quedarían dos movimientos de -3 contra un nivel de 7 en vez de 4:
 * el snapshot dejaría de ser la suma del historial, en silencio, que es
 * exactamente el fallo que este módulo existe para impedir.
 *
 * Con `increment` la operación es un UPDATE atómico que toma el lock de la
 * fila, así que las dos ventas se serializan solas.
 *
 * Privada: nadie toca el stock sin pasar por una de las operaciones de abajo.
 */
async function incrementLevel(
  tx: Tx,
  variantId: string,
  warehouseId: string,
  delta: number
): Promise<number> {
  const level = await tx.stockLevel.upsert({
    where: { variantId_warehouseId: { variantId, warehouseId } },
    create: { variantId, warehouseId, quantity: delta },
    update: { quantity: { increment: delta } },
  });
  return round3(level.quantity);
}

/** Deja el snapshot en un valor absoluto. Solo para conteos y carga inicial. */
async function setLevel(
  tx: Tx,
  variantId: string,
  warehouseId: string,
  quantity: number
): Promise<void> {
  await tx.stockLevel.upsert({
    where: { variantId_warehouseId: { variantId, warehouseId } },
    create: { variantId, warehouseId, quantity },
    update: { quantity },
  });
}

function guard(nextQuantity: number, allowNegative: boolean, sku?: string): void {
  if (nextQuantity < 0 && !allowNegative) throw new InsufficientStockError(sku);
}

export type ApplyMovementInput = {
  variantId: string;
  warehouseId: string;
  type: MovementType;
  /** Delta YA firmado. Usa toDelta() si vienes de un número crudo del usuario. */
  delta: Numeric;
  userId: string;
  reason?: string | null;
  saleId?: string | null;
  purchaseId?: string | null;
  productionId?: string | null;
  /**
   * Permite dejar el stock en negativo. Solo lo usa la anulación de una compra
   * ya recibida: si parte de esa mercadería ya se vendió, revertir la entrada
   * deja el saldo bajo cero, y eso es una corrección legítima de un error.
   */
  allowNegative?: boolean;
  /** SKU para el mensaje de error cuando el llamador ya lo tiene a mano. */
  sku?: string;
};

/** Registra un movimiento nuevo y deja el snapshot al día. */
export async function applyMovement(tx: Tx, input: ApplyMovementInput) {
  const {
    variantId,
    warehouseId,
    type,
    delta: rawDelta,
    userId,
    reason,
    saleId,
    purchaseId,
    productionId,
    allowNegative = false,
    sku,
  } = input;

  // Se redondea a las tres décimas que guarda la base antes de operar: si no,
  // el valor escrito y el calculado se separan y el snapshot deja de ser la
  // suma del historial.
  const delta = round3(rawDelta);

  // El nivel se suma primero y de forma atómica; si el resultado quedó bajo
  // cero se lanza y la transacción revierte todo, incluido este incremento.
  // Validar antes de escribir sería volver al read-modify-write inseguro.
  const nextQuantity = await incrementLevel(tx, variantId, warehouseId, delta);
  guard(nextQuantity, allowNegative, sku);

  const movement = await tx.stockMovement.create({
    data: {
      variantId,
      warehouseId,
      type,
      quantity: delta,
      reason: reason || null,
      userId,
      saleId: saleId ?? null,
      purchaseId: purchaseId ?? null,
      productionId: productionId ?? null,
    },
    include: {
      variant: { include: { product: true } },
      warehouse: true,
      user: { select: { name: true } },
    },
  });

  return { movement, quantity: nextQuantity };
}

/**
 * Corrige un movimiento manual ya registrado. Saca el efecto del viejo y aplica
 * el nuevo en un solo paso, no en dos: así no se pasa por un estado intermedio
 * negativo al cambiar, por ejemplo, una entrada grande por una chica.
 */
export async function replaceMovement(
  tx: Tx,
  current: { id: string; variantId: string; warehouseId: string; quantity: Numeric },
  next: { type: MovementType; delta: Numeric; reason?: string | null }
) {
  const delta = round3(next.delta);
  const nextQuantity = await incrementLevel(
    tx,
    current.variantId,
    current.warehouseId,
    round3(delta - toNumber(current.quantity))
  );
  guard(nextQuantity, false);

  return tx.stockMovement.update({
    where: { id: current.id },
    data: { type: next.type, quantity: delta, reason: next.reason || null },
    include: {
      variant: { include: { product: true } },
      warehouse: true,
      user: { select: { name: true } },
    },
  });
}

/** Elimina un movimiento manual y descuenta su efecto del snapshot. */
export async function removeMovement(
  tx: Tx,
  current: { id: string; variantId: string; warehouseId: string; quantity: Numeric }
): Promise<void> {
  const nextQuantity = await incrementLevel(
    tx,
    current.variantId,
    current.warehouseId,
    round3(-toNumber(current.quantity))
  );
  guard(nextQuantity, false);

  await tx.stockMovement.delete({ where: { id: current.id } });
}

export type SetStockInput = {
  variantId: string;
  warehouseId: string;
  /** Valor absoluto al que debe quedar el stock, no un delta. */
  quantity: Numeric;
  userId: string;
  reason: string;
};

/**
 * Deja el stock en un valor absoluto y documenta la diferencia como AJUSTE.
 * Lo usan la carga inicial de una variante nueva y la importación desde Excel.
 * Siempre deja el StockLevel creado, aunque la diferencia sea 0, pero solo
 * escribe en el historial si hay un cambio real que documentar.
 *
 * Devuelve el delta aplicado: 0 significa que no se registró ningún movimiento.
 */
export async function setStockAbsolute(tx: Tx, input: SetStockInput): Promise<number> {
  const { variantId, warehouseId, userId, reason } = input;

  const quantity = round3(input.quantity);

  // Un conteo físico no puede dejar el stock negativo: eso sería un error de
  // digitación, no un hallazgo.
  guard(quantity, false);

  // El nivel se lee recién acá, nunca desde una caché del llamador. Antes esta
  // función aceptaba un stock prefetcheado, y el importador masivo se lo pasaba
  // desde el comienzo de una transacción que puede durar 55 segundos: cualquier
  // venta ocurrida en esa ventana quedaba pisada, y el snapshot dejaba de ser
  // la suma del historial.
  const current = await currentStock(tx, variantId, warehouseId);
  const delta = round3(quantity - current);

  if (delta === 0) {
    // Aun sin diferencia hay que dejar la fila creada: una variante nueva debe
    // tener su StockLevel aunque arranque en cero.
    await setLevel(tx, variantId, warehouseId, quantity);
    return 0;
  }

  // Se aplica como incremento atómico, no como asignación del absoluto. Así el
  // movimiento que se registra y el cambio real del nivel son el mismo número
  // pase lo que pase en paralelo: el absoluto queda best-effort, pero la
  // invariante —nivel igual a la suma del historial— se mantiene siempre.
  await incrementLevel(tx, variantId, warehouseId, delta);

  await tx.stockMovement.create({
    data: { variantId, warehouseId, type: "AJUSTE", quantity: delta, reason, userId },
  });

  return delta;
}
