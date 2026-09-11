import { describe, it, expect, beforeEach } from "vitest";
import {
  applyProduction,
  scaleRecipe,
  InvalidRecipeError,
  WastageExceedsStockError,
} from "./production";
import { InsufficientStockError, type Tx } from "./inventory";
import { FakeTx } from "./test-support/fake-tx";

const PAN = "variante-pan";
const HARINA = "insumo-harina";
const LEVADURA = "insumo-levadura";
const W = "bodega-1";
const USER = "usuario-1";

let tx: FakeTx;
const asTx = () => tx as unknown as Tx;

beforeEach(() => {
  tx = new FakeTx();
});

/** Deja insumos disponibles para poder hornear. */
async function seedInsumos(harina = 25, levadura = 2) {
  tx.levels.set(`${HARINA}:${W}`, harina);
  tx.levels.set(`${LEVADURA}:${W}`, levadura);
}

describe("scaleRecipe", () => {
  const receta = {
    yield: 200,
    items: [
      { variantId: HARINA, quantity: 12.5 },
      { variantId: LEVADURA, quantity: 0.25 },
    ],
  };

  it("produce la receta completa sin escalar nada", () => {
    expect(scaleRecipe(receta, 200)).toEqual([
      { variantId: HARINA, quantity: 12.5 },
      { variantId: LEVADURA, quantity: 0.25 },
    ]);
  });

  it("escala proporcionalmente y redondea a las tres décimas de la base", () => {
    // 12,5 kg rinden 200 panes: 0,0625 por pan. 37 panes son 2,3125 kg.
    expect(scaleRecipe(receta, 37)).toEqual([
      { variantId: HARINA, quantity: 2.313 },
      { variantId: LEVADURA, quantity: 0.046 },
    ]);
  });

  it("el doble de la receta consume el doble de insumos", () => {
    expect(scaleRecipe(receta, 400)).toEqual([
      { variantId: HARINA, quantity: 25 },
      { variantId: LEVADURA, quantity: 0.5 },
    ]);
  });

  it("una receta que rinde cero no se puede escalar", () => {
    expect(() => scaleRecipe({ yield: 0, items: [] }, 10)).toThrow(InvalidRecipeError);
  });
});

describe("applyProduction", () => {
  it("consume los insumos, ingresa lo producido y descuenta la merma", async () => {
    await seedInsumos();
    tx.seedRecipe(PAN, 200, [[HARINA, 12.5], [LEVADURA, 0.25]]);

    await applyProduction(asTx(), {
      warehouseId: W,
      userId: USER,
      items: [{ variantId: PAN, quantityProduced: 200, quantityWasted: 18 }],
    });

    expect(tx.levelFor(HARINA, W)).toBe(12.5);
    expect(tx.levelFor(LEVADURA, W)).toBe(1.75);
    expect(tx.levelFor(PAN, W)).toBe(182);
    expect(tx.sumFor(PAN, W)).toBe(182);
    expect(tx.sumFor(HARINA, W)).toBe(-12.5);
  });

  it("deja las tres clases de huella en el historial", async () => {
    await seedInsumos();
    tx.seedRecipe(PAN, 200, [[HARINA, 12.5]]);

    await applyProduction(asTx(), {
      warehouseId: W,
      userId: USER,
      items: [{ variantId: PAN, quantityProduced: 200, quantityWasted: 18 }],
    });

    expect(tx.movementsOfType("CONSUMO")).toHaveLength(1);
    expect(tx.movementsOfType("PRODUCCION")).toHaveLength(1);
    expect(tx.movementsOfType("MERMA")).toHaveLength(1);
  });

  it("todos los movimientos apuntan a la misma orden: esa es la trazabilidad", async () => {
    await seedInsumos();
    tx.seedRecipe(PAN, 200, [[HARINA, 12.5], [LEVADURA, 0.25]]);

    const orden = await applyProduction(asTx(), {
      warehouseId: W,
      userId: USER,
      items: [{ variantId: PAN, quantityProduced: 100, quantityWasted: 5 }],
    });

    expect(tx.movements).toHaveLength(4);
    for (const m of tx.movements) {
      expect(m.productionId).toBe(orden.id);
    }
  });

  it("un producto sin receta se produce igual, sin consumir nada", async () => {
    await applyProduction(asTx(), {
      warehouseId: W,
      userId: USER,
      items: [{ variantId: PAN, quantityProduced: 50 }],
    });

    expect(tx.levelFor(PAN, W)).toBe(50);
    expect(tx.movementsOfType("CONSUMO")).toHaveLength(0);
    expect(tx.movements).toHaveLength(1);
  });

  it("si falta insumo se corta antes de producir nada", async () => {
    await seedInsumos(1, 2);
    tx.seedRecipe(PAN, 200, [[HARINA, 12.5]]);

    await expect(
      tx.inTransaction(() =>
        applyProduction(asTx(), {
          warehouseId: W,
          userId: USER,
          items: [{ variantId: PAN, quantityProduced: 200 }],
        })
      )
    ).rejects.toBeInstanceOf(InsufficientStockError);

    // Lo importante: no alcanzó a entrar pan. En producción la transacción
    // revierte también la orden; el doble no simula eso.
    expect(tx.movementsOfType("PRODUCCION")).toHaveLength(0);
    expect(tx.levelFor(PAN, W)).toBe(0);
  });

  it("la merma se descuenta después de producir, nunca antes", async () => {
    // Sin stock previo de pan: si la merma se aplicara primero, el stock
    // quedaría negativo y la operación se rechazaría.
    await applyProduction(asTx(), {
      warehouseId: W,
      userId: USER,
      items: [{ variantId: PAN, quantityProduced: 20, quantityWasted: 20 }],
    });

    expect(tx.levelFor(PAN, W)).toBe(0);
    expect(tx.sumFor(PAN, W)).toBe(0);
  });

  it("hornear una cantidad parcial consume la fracción redondeada", async () => {
    await seedInsumos();
    tx.seedRecipe(PAN, 200, [[HARINA, 12.5]]);

    await applyProduction(asTx(), {
      warehouseId: W,
      userId: USER,
      items: [{ variantId: PAN, quantityProduced: 37 }],
    });

    expect(tx.levelFor(HARINA, W)).toBe(22.687);
    expect(tx.levelFor(PAN, W)).toBe(37);
    expect(tx.sumFor(HARINA, W)).toBe(-2.313);
  });

  it("varios productos en una sola producción", async () => {
    await seedInsumos(50);
    tx.seedRecipe(PAN, 200, [[HARINA, 12.5]]);
    const HALLULLA = "variante-hallulla";
    tx.seedRecipe(HALLULLA, 100, [[HARINA, 8]]);

    await applyProduction(asTx(), {
      warehouseId: W,
      userId: USER,
      items: [
        { variantId: PAN, quantityProduced: 200 },
        { variantId: HALLULLA, quantityProduced: 50, quantityWasted: 4 },
      ],
    });

    expect(tx.levelFor(HARINA, W)).toBe(50 - 12.5 - 4);
    expect(tx.levelFor(PAN, W)).toBe(200);
    expect(tx.levelFor(HALLULLA, W)).toBe(46);
    expect(tx.productionItems).toHaveLength(2);
  });

  it("produce primero el insumo que se fabrica en la misma orden, sin importar el orden de las filas", async () => {
    const MASA = "variante-masa";
    tx.levels.set(`${HARINA}:${W}`, 30);
    tx.seedRecipe(MASA, 10, [[HARINA, 6]]);
    tx.seedRecipe(PAN, 20, [[MASA, 8]]);

    // El pan va PRIMERO en la lista, aunque consume masa que se produce después.
    await applyProduction(asTx(), {
      warehouseId: W,
      userId: USER,
      items: [
        { variantId: PAN, quantityProduced: 20 },
        { variantId: MASA, quantityProduced: 10 },
      ],
    });

    expect(tx.levelFor(HARINA, W)).toBe(24);
    expect(tx.levelFor(MASA, W)).toBe(2);
    expect(tx.levelFor(PAN, W)).toBe(20);
    expect(tx.sumFor(MASA, W)).toBe(2);
  });

  it("una receta marcada como no vigente no descuenta insumos", async () => {
    await seedInsumos();
    tx.seedRecipe(PAN, 200, [[HARINA, 12.5]]);
    tx.inactiveRecipes.add(PAN);

    await applyProduction(asTx(), {
      warehouseId: W,
      userId: USER,
      items: [{ variantId: PAN, quantityProduced: 200 }],
    });

    expect(tx.levelFor(HARINA, W)).toBe(25);
    expect(tx.levelFor(PAN, W)).toBe(200);
    expect(tx.movementsOfType("CONSUMO")).toHaveLength(0);
  });

  it("un insumo que al escalar redondea a cero no se registra", async () => {
    tx.levels.set(`${LEVADURA}:${W}`, 1);
    // 0,08 de levadura para 200 panes son 0,0004 por pan: hornear 1 redondea a 0.
    tx.seedRecipe(PAN, 200, [[LEVADURA, 0.08]]);

    await applyProduction(asTx(), {
      warehouseId: W,
      userId: USER,
      items: [{ variantId: PAN, quantityProduced: 1 }],
    });

    expect(tx.movementsOfType("CONSUMO")).toHaveLength(0);
    expect(tx.levelFor(LEVADURA, W)).toBe(1);
    expect(tx.levelFor(PAN, W)).toBe(1);
  });

  it("permite registrar solo merma, sin producción: el pan de ayer que se endureció", async () => {
    // Es el flujo real: la producción se registra en la mañana, cuando sale
    // del horno, y la merma al cierre. Sin esto habría que esperar al cierre
    // para dar de alta el pan, y las ventas del día no tendrían stock contra
    // el cual descontar.
    tx.levels.set(`${PAN}:${W}`, 40);

    await applyProduction(asTx(), {
      warehouseId: W,
      userId: USER,
      items: [{ variantId: PAN, quantityProduced: 0, quantityWasted: 12 }],
    });

    expect(tx.levelFor(PAN, W)).toBe(28);
    expect(tx.movementsOfType("MERMA")).toHaveLength(1);
    expect(tx.movementsOfType("PRODUCCION")).toHaveLength(0);
    expect(tx.movementsOfType("CONSUMO")).toHaveLength(0);
  });

  it("la merma que supera el stock se rechaza con un mensaje sobre merma, no sobre insumos", async () => {
    tx.levels.set(`${PAN}:${W}`, 5);
    await expect(
      tx.inTransaction(() =>
        applyProduction(asTx(), {
          warehouseId: W,
          userId: USER,
          items: [{ variantId: PAN, quantityProduced: 0, quantityWasted: 20 }],
        })
      )
    ).rejects.toBeInstanceOf(WastageExceedsStockError);
    expect(tx.levelFor(PAN, W)).toBe(5);
  });

  it("dos líneas del mismo producto se rechazan en vez de perderse una", async () => {
    await expect(
      tx.inTransaction(() =>
        applyProduction(asTx(), {
          warehouseId: W,
          userId: USER,
          items: [
            { variantId: PAN, quantityProduced: 20 },
            { variantId: PAN, quantityProduced: 15 },
          ],
        })
      )
    ).rejects.toMatchObject({ message: "DUPLICATE_PRODUCTION_ITEM" });
    expect(tx.movements).toHaveLength(0);
  });

  it("rechaza cantidades negativas antes de crear la orden", async () => {
    await expect(
      tx.inTransaction(() =>
        applyProduction(asTx(), {
          warehouseId: W,
          userId: USER,
          items: [
            { variantId: PAN, quantityProduced: 10 },
            { variantId: "otro", quantityProduced: -5 },
          ],
        })
      )
    ).rejects.toMatchObject({ message: "NEGATIVE_QUANTITY" });
    expect(tx.productions).toHaveLength(0);
    expect(tx.movements).toHaveLength(0);
  });

  it("rechaza cantidades negativas", async () => {
    await expect(
      applyProduction(asTx(), {
        warehouseId: W,
        userId: USER,
        items: [{ variantId: PAN, quantityProduced: -5 }],
      })
    ).rejects.toMatchObject({ message: "NEGATIVE_QUANTITY" });
  });

  it("producir cero solo registra la línea, sin tocar el inventario", async () => {
    await seedInsumos();
    tx.seedRecipe(PAN, 200, [[HARINA, 12.5]]);

    await applyProduction(asTx(), {
      warehouseId: W,
      userId: USER,
      items: [{ variantId: PAN, quantityProduced: 0 }],
    });

    expect(tx.movements).toHaveLength(0);
    expect(tx.productionItems).toHaveLength(1);
    expect(tx.levelFor(HARINA, W)).toBe(25);
  });
});
