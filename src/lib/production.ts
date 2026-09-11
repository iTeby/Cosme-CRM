import type { Prisma } from "@prisma/client";
import { round3, toNumber, type Numeric } from "./decimal";
import { applyMovement, InsufficientStockError } from "./inventory";

// Producción: la parte del negocio que el CRM no modelaba.
//
// Un almacén con panadería no solo compra y vende, transforma. Este módulo es
// el único que escribe producciones, y lo hace apoyándose en inventory.ts: no
// toca StockLevel ni StockMovement por su cuenta.
//
// Cada producción deja tres clases de huella en el historial, todas apuntando a
// la misma orden:
//   CONSUMO     por cada insumo que la receta descuenta
//   PRODUCCION  por cada producto que entra al inventario
//   MERMA       por lo que se registró como perdido al cierre
//
// Esa cadena es la que permite seguir la ruta del pan y los insumos de punta a
// punta sin ninguna tabla de trazabilidad: se lee de stock_movements.

export type Tx = Prisma.TransactionClient;

/** La merma registrada supera lo que hay en bodega. */
export class WastageExceedsStockError extends Error {
  readonly sku?: string;
  constructor(sku?: string) {
    super("WASTAGE_EXCEEDS_STOCK");
    this.name = "WastageExceedsStockError";
    this.sku = sku;
  }
}

/** La receta no puede rendir cero: no habría con qué escalarla. */
export class InvalidRecipeError extends Error {
  readonly sku?: string;
  constructor(sku?: string) {
    super("INVALID_RECIPE");
    this.name = "InvalidRecipeError";
    this.sku = sku;
  }
}

export type RecipeLike = {
  yield: Numeric;
  items: { variantId: string; quantity: Numeric }[];
};

/**
 * Escala una receta a la cantidad que se va a producir.
 *
 * La receta declara cuánto insumo hace falta para rendir `yield` unidades;
 * hornear una cantidad distinta consume proporcionalmente. Cada resultado se
 * redondea a las tres décimas que guarda la base, porque escalar produce
 * fracciones largas: 12,5 kg de harina que rinden 200 panes son 0,0625 kg por
 * pan.
 */
export function scaleRecipe(recipe: RecipeLike, quantityProduced: Numeric) {
  const yieldQty = toNumber(recipe.yield);
  if (yieldQty <= 0) throw new InvalidRecipeError();

  const factor = toNumber(quantityProduced) / yieldQty;
  return recipe.items.map((item) => ({
    variantId: item.variantId,
    quantity: round3(toNumber(item.quantity) * factor),
  }));
}

export type ProductionItemInput = {
  variantId: string;
  quantityProduced: Numeric;
  /** Lo que no se vendió y se registra como perdido al cierre del día. */
  quantityWasted?: Numeric;
};

export type ApplyProductionInput = {
  warehouseId: string;
  userId: string;
  producedOn?: Date;
  notes?: string | null;
  items: ProductionItemInput[];
};

/**
 * Ordena los ítems para que un producto que es insumo de otro se produzca
 * antes de ser consumido.
 *
 * Sin esto la producción funcionaría o fallaría según el orden en que la dueña
 * tipeó las filas: si hornea masa y pan en el mismo registro, y el pan consume
 * masa, poner el pan primero daba "no hay insumo suficiente". Con el orden
 * resuelto acá, el resultado no depende de cómo se escribió el formulario.
 *
 * Si hubiera un ciclo (A consume B y B consume A) se corta y se sigue: es una
 * receta mal armada, y va a fallar con un error de stock que dice cuál insumo
 * falta, que es más útil que un error de ciclo.
 */
function orderByDependency<T extends { variantId: string }>(
  items: T[],
  inputsOf: Map<string, Set<string>>
): T[] {
  const producedHere = new Set(items.map((i) => i.variantId));
  const byVariant = new Map(items.map((i) => [i.variantId, i]));
  const ordered: T[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();

  const visit = (variantId: string) => {
    if (done.has(variantId) || visiting.has(variantId)) return;
    visiting.add(variantId);
    for (const input of inputsOf.get(variantId) ?? []) {
      if (producedHere.has(input)) visit(input);
    }
    visiting.delete(variantId);
    done.add(variantId);
    const item = byVariant.get(variantId);
    if (item) ordered.push(item);
  };

  for (const item of items) visit(item.variantId);

  // Red de seguridad. El mapa por variante colapsaría dos líneas del mismo
  // producto en una, y esa línea desaparecería sin error ni movimiento. Hoy lo
  // impide una validación de zod en otro archivo; esta función no puede
  // depender de eso, porque se exporta y se puede llamar desde otro lado.
  if (ordered.length !== items.length) {
    throw new Error("DUPLICATE_PRODUCTION_ITEM");
  }
  return ordered;
}

/**
 * Registra una producción completa dentro de una transacción.
 *
 * Orden de las operaciones por producto, y no es arbitrario:
 *   1. se consumen los insumos — si falta harina, todo se aborta acá
 *   2. entra lo producido
 *   3. recién entonces se descuenta la merma, para que nunca haya que restar
 *      un pan que todavía no entró al inventario
 *
 * Y entre productos manda orderByDependency(), para que un insumo producido en
 * la misma orden exista antes de consumirse.
 *
 * Un producto sin receta cargada se produce igual, sin consumir nada. Es
 * deliberado: la dueña puede empezar a registrar lo que hornea antes de haber
 * cargado las recetas, y obligarla a cargarlas primero sería pedirle el trabajo
 * más aburrido antes de darle nada a cambio.
 */
export async function applyProduction(tx: Tx, input: ApplyProductionInput) {
  const { warehouseId, userId, producedOn, notes, items } = input;

  for (const item of items) {
    if (toNumber(item.quantityProduced) < 0 || toNumber(item.quantityWasted ?? 0) < 0) {
      throw new Error("NEGATIVE_QUANTITY");
    }
  }

  // Todas las recetas de una vez, no una consulta por línea.
  const recipes = await tx.recipe.findMany({
    where: { variantId: { in: items.map((i) => i.variantId) } },
    include: { items: true },
  });
  const recipeByVariant = new Map(recipes.map((r) => [r.variantId, r]));

  const inputsOf = new Map<string, Set<string>>(
    recipes.map((r) => [r.variantId, new Set(r.items.map((i) => i.variantId))])
  );

  // Los SKU de todos los insumos de una vez, para los mensajes de error.
  const inputIds = [...new Set(recipes.flatMap((r) => r.items.map((i) => i.variantId)))];
  const inputVariants = inputIds.length
    ? await tx.productVariant.findMany({
        where: { id: { in: inputIds } },
        select: { id: true, sku: true },
      })
    : [];
  const skuById = new Map(inputVariants.map((v) => [v.id, v.sku]));

  const order = await tx.productionOrder.create({
    data: {
      warehouseId,
      createdById: userId,
      producedOn: producedOn ?? new Date(),
      notes: notes || null,
    },
  });

  for (const item of orderByDependency(items, inputsOf)) {
    const produced = round3(item.quantityProduced);
    const wasted = round3(item.quantityWasted ?? 0);

    await tx.productionItem.create({
      data: {
        productionId: order.id,
        variantId: item.variantId,
        quantityProduced: produced,
        quantityWasted: wasted,
      },
    });

    // 1. Insumos
    const recipe = recipeByVariant.get(item.variantId);
    if (recipe && recipe.active && produced > 0) {
      for (const ingredient of scaleRecipe(recipe, produced)) {
        // Una cantidad que al escalar redondea a cero no se registra: un
        // movimiento de 0 no dice nada. Pasa con insumos ínfimos en lotes
        // chicos, y significa que ese insumo se va a agotar en la bodega real
        // antes que en el sistema. Si empieza a importar, la receta necesita
        // más precisión que las tres décimas que guarda la base.
        if (ingredient.quantity === 0) continue;
        await applyMovement(tx, {
          variantId: ingredient.variantId,
          warehouseId,
          type: "CONSUMO",
          delta: -ingredient.quantity,
          reason: `Producción #${order.number}`,
          userId,
          productionId: order.id,
          sku: skuById.get(ingredient.variantId),
        });
      }
    }

    // 2. Lo producido
    if (produced > 0) {
      await applyMovement(tx, {
        variantId: item.variantId,
        warehouseId,
        type: "PRODUCCION",
        delta: produced,
        reason: `Producción #${order.number}`,
        userId,
        productionId: order.id,
      });
    }

    // 3. La merma, después de producir
    if (wasted > 0) {
      try {
        await applyMovement(tx, {
          variantId: item.variantId,
          warehouseId,
          type: "MERMA",
          delta: -wasted,
          reason: `Merma de producción #${order.number}`,
          userId,
          productionId: order.id,
        });
      } catch (err) {
        // Se traduce el error: acá no falta ningún insumo, sobra merma. Decir
        // "no hay insumo suficiente" cuando la dueña registró más merma que
        // pan la deja buscando un problema que no existe.
        if (err instanceof InsufficientStockError) {
          throw new WastageExceedsStockError(skuById.get(item.variantId));
        }
        throw err;
      }
    }
  }

  return order;
}
