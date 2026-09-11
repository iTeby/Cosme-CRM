import { describe, it, expect, beforeEach } from "vitest";
import { round3 } from "./decimal";
import {
  applyMovement,
  replaceMovement,
  removeMovement,
  setStockAbsolute,
  currentStock,
  toDelta,
  InsufficientStockError,
  type Tx,
} from "./inventory";

import { FakeTx, Dec } from "./test-support/fake-tx";

const V = "variante-1";
const W = "bodega-1";
const USER = "usuario-1";

let tx: FakeTx;
const asTx = () => tx as unknown as Tx;

beforeEach(() => {
  tx = new FakeTx();
});

function expectInvariant() {
  expect(tx.levelFor(V, W)).toBe(tx.sumFor(V, W));
}

describe("toDelta", () => {
  it("ENTRADA suma tal cual", () => {
    expect(toDelta("ENTRADA", 5)).toBe(5);
  });

  it("SALIDA siempre resta, venga como venga escrita", () => {
    expect(toDelta("SALIDA", 5)).toBe(-5);
    expect(toDelta("SALIDA", -5)).toBe(-5);
  });

  it("AJUSTE se aplica tal cual y admite negativo", () => {
    expect(toDelta("AJUSTE", -3)).toBe(-3);
    expect(toDelta("AJUSTE", 3)).toBe(3);
  });

  it("MERMA y CONSUMO restan: el pan que no se vendió y la harina que se horneó", () => {
    expect(toDelta("MERMA", 12)).toBe(-12);
    expect(toDelta("CONSUMO", 2.5)).toBe(-2.5);
  });

  it("PRODUCCION suma: el pan que sale del horno entra al inventario", () => {
    expect(toDelta("PRODUCCION", 200)).toBe(200);
  });

  it("redondea los medios alejándose del cero, igual que numeric en Postgres", () => {
    expect(round3(2.3125)).toBe(2.313);
    expect(round3(-2.3125)).toBe(-2.313);
    expect(round3(0.0005)).toBe(0.001);
    expect(round3(-0.0005)).toBe(-0.001);
    // Estos fallaban con la implementación de multiplicar por 1000: el error
    // binario del producto los tiraba para abajo.
    expect(round3(0.5005)).toBe(0.501);
    expect(round3(-0.5005)).toBe(-0.501);
    expect(round3(1.0005)).toBe(1.001);
    expect(round3(131.0715)).toBe(131.072);
  });

  it("nunca devuelve cero negativo, que se imprimiría como -0", () => {
    expect(Object.is(round3(-0.0001), 0)).toBe(true);
    expect(Object.is(round3(-0), 0)).toBe(true);
  });

  it("los tipos con signo fijo ignoran el signo que venga escrito", () => {
    expect(toDelta("ENTRADA", -5)).toBe(5);
    expect(toDelta("PRODUCCION", -200)).toBe(200);
    expect(toDelta("MERMA", -12)).toBe(-12);
  });

  it("acepta cantidades que llegan como texto, que es como viaja un Decimal", () => {
    expect(toDelta("ENTRADA", "2.5")).toBe(2.5);
    expect(toDelta("SALIDA", "0.75")).toBe(-0.75);
  });
});

describe("cantidades decimales", () => {
  it("normaliza el Decimal que devuelve Prisma en vez de concatenarlo", async () => {
    tx.levels.set(`${V}:${W}`, new Dec("10") as never);
    expect(await currentStock(asTx(), V, W)).toBe(10);
  });

  it("suma sobre un nivel que llega como Decimal", async () => {
    tx.levels.set(`${V}:${W}`, new Dec("10.5") as never);
    await applyMovement(asTx(), {
      variantId: V, warehouseId: W, type: "ENTRADA", delta: "2.25", userId: USER,
    });
    expect(tx.levelFor(V, W)).toBe(12.75);
  });

  it("vender medio kilo de pan deja el stock en 1,5", async () => {
    await applyMovement(asTx(), { variantId: V, warehouseId: W, type: "ENTRADA", delta: 2, userId: USER });
    await applyMovement(asTx(), {
      variantId: V, warehouseId: W, type: "SALIDA", delta: toDelta("SALIDA", 0.5), userId: USER,
    });
    expect(tx.levelFor(V, W)).toBe(1.5);
    expectInvariant();
  });

  it("la guarda de stock negativo funciona con decimales", async () => {
    await applyMovement(asTx(), { variantId: V, warehouseId: W, type: "ENTRADA", delta: 0.4, userId: USER });
    await expect(
      tx.inTransaction(() =>
        applyMovement(asTx(), { variantId: V, warehouseId: W, type: "SALIDA", delta: -0.5, userId: USER })
      )
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect(tx.levelFor(V, W)).toBe(0.4);
  });

  it("redondea a las tres décimas que guarda la base", async () => {
    await applyMovement(asTx(), { variantId: V, warehouseId: W, type: "ENTRADA", delta: 0.1, userId: USER });
    await applyMovement(asTx(), { variantId: V, warehouseId: W, type: "ENTRADA", delta: 0.2, userId: USER });
    // Sin redondeo esto daría 0.30000000000000004 y el nivel se separaría del
    // historial por una cola invisible que crece con cada movimiento.
    expect(tx.levelFor(V, W)).toBe(0.3);
    expectInvariant();
  });

  it("una receta escalada no arrastra decimales largos", async () => {
    // 12,5 kg de harina rinden 200 panes: 0,0625 kg por pan. Hornear 37 panes
    // consume 2,3125 kg, que la base guarda como 2,313.
    await applyMovement(asTx(), { variantId: V, warehouseId: W, type: "ENTRADA", delta: 25, userId: USER });
    await applyMovement(asTx(), {
      variantId: V, warehouseId: W, type: "CONSUMO",
      delta: toDelta("CONSUMO", (12.5 / 200) * 37), userId: USER,
    });
    expect(tx.movements[1].quantity).toBe(-2.313);
    expect(tx.levelFor(V, W)).toBe(22.687);
    expectInvariant();
  });

  it("un consumo de insumo y su producción se registran como una cadena", async () => {
    const HARINA = "insumo-harina";
    await applyMovement(asTx(), { variantId: HARINA, warehouseId: W, type: "ENTRADA", delta: 25, userId: USER });
    await applyMovement(asTx(), {
      variantId: HARINA, warehouseId: W, type: "CONSUMO",
      delta: toDelta("CONSUMO", 12.5), userId: USER, reason: "Producción #1",
    });
    await applyMovement(asTx(), {
      variantId: V, warehouseId: W, type: "PRODUCCION",
      delta: toDelta("PRODUCCION", 200), userId: USER, reason: "Producción #1",
    });
    await applyMovement(asTx(), {
      variantId: V, warehouseId: W, type: "MERMA",
      delta: toDelta("MERMA", 18), userId: USER, reason: "Cierre del día",
    });

    expect(tx.levelFor(HARINA, W)).toBe(12.5);
    expect(tx.levelFor(V, W)).toBe(182);
    expect(tx.movements.filter((m) => m.reason === "Producción #1")).toHaveLength(2);
    expectInvariant();
  });
});

describe("applyMovement", () => {
  it("una entrada sobre stock inexistente deja el nivel y el historial en el mismo número", async () => {
    await applyMovement(asTx(), {
      variantId: V, warehouseId: W, type: "ENTRADA", delta: 10, userId: USER,
    });
    expect(tx.levelFor(V, W)).toBe(10);
    expect(tx.movements).toHaveLength(1);
    expect(tx.movements[0].quantity).toBe(10);
    expectInvariant();
  });

  it("una salida descuenta", async () => {
    await applyMovement(asTx(), { variantId: V, warehouseId: W, type: "ENTRADA", delta: 10, userId: USER });
    await applyMovement(asTx(), { variantId: V, warehouseId: W, type: "SALIDA", delta: -3, userId: USER });
    expect(tx.levelFor(V, W)).toBe(7);
    expectInvariant();
  });

  it("rechaza la salida que dejaría el stock negativo, y no escribe nada", async () => {
    await applyMovement(asTx(), { variantId: V, warehouseId: W, type: "ENTRADA", delta: 2, userId: USER });
    await expect(
      tx.inTransaction(() =>
        applyMovement(asTx(), { variantId: V, warehouseId: W, type: "SALIDA", delta: -3, userId: USER })
      )
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect(tx.levelFor(V, W)).toBe(2);
    expect(tx.movements).toHaveLength(1);
    expectInvariant();
  });

  it("el error lleva el SKU cuando el llamador lo conoce", async () => {
    await expect(
      applyMovement(asTx(), {
        variantId: V, warehouseId: W, type: "SALIDA", delta: -1, userId: USER, sku: "ABC-123",
      })
    ).rejects.toMatchObject({ sku: "ABC-123" });
  });

  it("allowNegative deja el stock bajo cero: anular una compra ya vendida en parte", async () => {
    await applyMovement(asTx(), { variantId: V, warehouseId: W, type: "ENTRADA", delta: 5, userId: USER });
    await applyMovement(asTx(), { variantId: V, warehouseId: W, type: "SALIDA", delta: -4, userId: USER });
    await applyMovement(asTx(), {
      variantId: V, warehouseId: W, type: "SALIDA", delta: -5, userId: USER, allowNegative: true,
    });
    expect(tx.levelFor(V, W)).toBe(-4);
    expectInvariant();
  });

  it("venta y anulación dejan el stock donde estaba, con las dos huellas en el historial", async () => {
    await applyMovement(asTx(), { variantId: V, warehouseId: W, type: "ENTRADA", delta: 10, userId: USER });
    await applyMovement(asTx(), {
      variantId: V, warehouseId: W, type: "SALIDA", delta: -3, userId: USER, saleId: "venta-1",
    });
    await applyMovement(asTx(), {
      variantId: V, warehouseId: W, type: "ENTRADA", delta: 3, userId: USER, saleId: "venta-1",
    });
    expect(tx.levelFor(V, W)).toBe(10);
    expect(tx.movements).toHaveLength(3);
    expect(tx.movements.filter((m) => m.saleId === "venta-1")).toHaveLength(2);
    expectInvariant();
  });

  it("suma el nivel sin leerlo antes: la aritmética la hace la base", async () => {
    // Ninguna lectura previa. Es lo que impide el lost update cuando dos
    // operaciones tocan el mismo stock a la vez.
    await applyMovement(asTx(), {
      variantId: V, warehouseId: W, type: "ENTRADA", delta: 6, userId: USER,
    });
    const lecturasAntes = tx.levelReads;
    await applyMovement(asTx(), {
      variantId: V, warehouseId: W, type: "ENTRADA", delta: 4, userId: USER,
    });
    expect(tx.levelReads).toBe(lecturasAntes);
    expect(tx.levelFor(V, W)).toBe(10);
    expectInvariant();
  });
});

describe("replaceMovement", () => {
  it("corrige la cantidad de un movimiento y reajusta el nivel", async () => {
    const { movement } = await applyMovement(asTx(), {
      variantId: V, warehouseId: W, type: "ENTRADA", delta: 10, userId: USER,
    });
    await replaceMovement(asTx(), movement as never, { type: "ENTRADA", delta: 4 });
    expect(tx.levelFor(V, W)).toBe(4);
    expect(tx.movements[0].quantity).toBe(4);
    expectInvariant();
  });

  it("aplica el cambio en un solo paso, sin pasar por un negativo intermedio", async () => {
    // Entra 10, se venden 9: el nivel queda en 1. Corregir la entrada de 10 a
    // 12 en dos pasos pasaría por -9 y sería rechazado; en un paso da 3.
    const { movement } = await applyMovement(asTx(), {
      variantId: V, warehouseId: W, type: "ENTRADA", delta: 10, userId: USER,
    });
    await applyMovement(asTx(), { variantId: V, warehouseId: W, type: "SALIDA", delta: -9, userId: USER });
    expect(tx.levelFor(V, W)).toBe(1);

    await replaceMovement(asTx(), movement as never, { type: "ENTRADA", delta: 12 });
    expect(tx.levelFor(V, W)).toBe(3);
    expectInvariant();
  });

  it("rechaza la corrección que dejaría el stock negativo", async () => {
    const { movement } = await applyMovement(asTx(), {
      variantId: V, warehouseId: W, type: "ENTRADA", delta: 10, userId: USER,
    });
    await applyMovement(asTx(), { variantId: V, warehouseId: W, type: "SALIDA", delta: -8, userId: USER });
    await expect(
      tx.inTransaction(() => replaceMovement(asTx(), movement as never, { type: "ENTRADA", delta: 4 }))
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect(tx.levelFor(V, W)).toBe(2);
  });
});

describe("removeMovement", () => {
  it("borra el movimiento y le saca su efecto al nivel", async () => {
    await applyMovement(asTx(), { variantId: V, warehouseId: W, type: "ENTRADA", delta: 10, userId: USER });
    const { movement } = await applyMovement(asTx(), {
      variantId: V, warehouseId: W, type: "ENTRADA", delta: 5, userId: USER,
    });
    await removeMovement(asTx(), movement as never);
    expect(tx.levelFor(V, W)).toBe(10);
    expect(tx.movements).toHaveLength(1);
    expectInvariant();
  });

  it("rechaza el borrado que dejaría el stock negativo", async () => {
    const { movement } = await applyMovement(asTx(), {
      variantId: V, warehouseId: W, type: "ENTRADA", delta: 10, userId: USER,
    });
    await applyMovement(asTx(), { variantId: V, warehouseId: W, type: "SALIDA", delta: -6, userId: USER });
    await expect(
      tx.inTransaction(() => removeMovement(asTx(), movement as never))
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect(tx.levelFor(V, W)).toBe(4);
  });
});

describe("setStockAbsolute", () => {
  it("deja el stock en el valor pedido y documenta la diferencia", async () => {
    const delta = await setStockAbsolute(asTx(), {
      variantId: V, warehouseId: W, quantity: 5, userId: USER, reason: "Carga inicial de stock",
    });
    expect(delta).toBe(5);
    expect(tx.levelFor(V, W)).toBe(5);
    expect(tx.movements).toHaveLength(1);
    expect(tx.movements[0].type).toBe("AJUSTE");
    expectInvariant();
  });

  it("no escribe en el historial si no hay diferencia que documentar", async () => {
    await setStockAbsolute(asTx(), {
      variantId: V, warehouseId: W, quantity: 5, userId: USER, reason: "Carga inicial de stock",
    });
    const delta = await setStockAbsolute(asTx(), {
      variantId: V, warehouseId: W, quantity: 5, userId: USER, reason: "Importación masiva desde Excel",
    });
    expect(delta).toBe(0);
    expect(tx.movements).toHaveLength(1);
    expectInvariant();
  });

  it("bajar el stock registra un ajuste negativo", async () => {
    await setStockAbsolute(asTx(), {
      variantId: V, warehouseId: W, quantity: 5, userId: USER, reason: "Carga inicial de stock",
    });
    const delta = await setStockAbsolute(asTx(), {
      variantId: V, warehouseId: W, quantity: 2, userId: USER, reason: "Importación masiva desde Excel",
    });
    expect(delta).toBe(-3);
    expect(tx.levelFor(V, W)).toBe(2);
    expectInvariant();
  });

  it("crea el nivel aunque la cantidad inicial sea cero, y sin movimiento", async () => {
    const delta = await setStockAbsolute(asTx(), {
      variantId: V, warehouseId: W, quantity: 0, userId: USER,
      reason: "Carga inicial de stock",
    });
    expect(delta).toBe(0);
    expect(tx.levels.has(`${V}:${W}`)).toBe(true);
    expect(tx.movements).toHaveLength(0);
  });

  it("lee el nivel al momento, no de una caché del llamador", async () => {
    // Aunque quien llama crea que el stock es otro, el ajuste se calcula
    // contra lo que hay en la base cuando se ejecuta. Es lo que impide que el
    // importador masivo pise una venta ocurrida durante su transacción.
    await applyMovement(asTx(), { variantId: V, warehouseId: W, type: "ENTRADA", delta: 3, userId: USER });
    const lecturasAntes = tx.levelReads;

    const delta = await setStockAbsolute(asTx(), {
      variantId: V, warehouseId: W, quantity: 8, userId: USER,
      reason: "Importación masiva desde Excel",
    });

    expect(tx.levelReads).toBeGreaterThan(lecturasAntes);
    expect(delta).toBe(5);
    expect(tx.levelFor(V, W)).toBe(8);
    expectInvariant();
  });

  it("rechaza un absoluto negativo: eso es un dedazo, no un hallazgo", async () => {
    await expect(
      tx.inTransaction(() =>
        setStockAbsolute(asTx(), {
          variantId: V, warehouseId: W, quantity: -5, userId: USER, reason: "Conteo físico",
        })
      )
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect(tx.movements).toHaveLength(0);
  });
});

describe("invariante del inventario", () => {
  it("el nivel sigue siendo la suma del historial tras una secuencia larga", async () => {
    await applyMovement(asTx(), { variantId: V, warehouseId: W, type: "ENTRADA", delta: 100, userId: USER });
    await applyMovement(asTx(), { variantId: V, warehouseId: W, type: "SALIDA", delta: -20, userId: USER });
    const { movement: corregible } = await applyMovement(asTx(), {
      variantId: V, warehouseId: W, type: "AJUSTE", delta: -5, userId: USER,
    });
    await applyMovement(asTx(), { variantId: V, warehouseId: W, type: "ENTRADA", delta: 30, userId: USER });
    await replaceMovement(asTx(), corregible as never, { type: "AJUSTE", delta: -2 });
    const { movement: borrable } = await applyMovement(asTx(), {
      variantId: V, warehouseId: W, type: "ENTRADA", delta: 7, userId: USER,
    });
    await removeMovement(asTx(), borrable as never);
    await setStockAbsolute(asTx(), {
      variantId: V, warehouseId: W, quantity: 50, userId: USER, reason: "Conteo físico",
    });

    expect(tx.levelFor(V, W)).toBe(50);
    expectInvariant();
    expect(await currentStock(asTx(), V, W)).toBe(50);
  });

  it("dos bodegas no se pisan", async () => {
    const W2 = "bodega-2";
    await applyMovement(asTx(), { variantId: V, warehouseId: W, type: "ENTRADA", delta: 10, userId: USER });
    await applyMovement(asTx(), { variantId: V, warehouseId: W2, type: "ENTRADA", delta: 4, userId: USER });
    await applyMovement(asTx(), { variantId: V, warehouseId: W, type: "SALIDA", delta: -6, userId: USER });
    expect(tx.levelFor(V, W)).toBe(4);
    expect(tx.levelFor(V, W2)).toBe(4);
    expect(tx.sumFor(V, W2)).toBe(4);
    expectInvariant();
  });
});
