import { beforeEach, describe, expect, it } from "vitest";
import {
  consumirFefo,
  diasHastaVencer,
  DIAS_POR_VENCER_POR_DEFECTO,
  estadoVencimiento,
  InsufficientLotStockError,
  LotNotAvailableError,
  lotesDisponibles,
  marcarVencidos,
  recibirLote,
  repartirFefo,
  vencimientoSugerido,
  type Tx,
} from "./lots";
import { applyMovement, LotRequiredError } from "./inventory";
import { FakeTx } from "./test-support/fake-tx";

const BODEGA = "b1";
const OTRA_BODEGA = "b2";
const PAN = "v-pan";
const USER = "u1";
const HOY = new Date("2026-09-11T12:00:00Z");

const dia = (n: number) => new Date(`2026-09-${String(n).padStart(2, "0")}T00:00:00Z`);

let tx: FakeTx;
const asTx = () => tx as unknown as Tx;

beforeEach(() => {
  tx = new FakeTx();
});

describe("lotesDisponibles", () => {
  it("primero el que vence antes, no el que llegó antes", () => {
    // Es toda la diferencia entre FEFO y FIFO, y es la razón de existir del
    // módulo: la tanda más vieja puede vencer después que una recién llegada.
    tx.seedLot("l-viejo", PAN, BODEGA, 10, {
      expiresAt: dia(30),
      receivedAt: new Date("2026-09-01T00:00:00Z"),
    });
    tx.seedLot("l-nuevo", PAN, BODEGA, 10, {
      expiresAt: dia(12),
      receivedAt: new Date("2026-09-10T00:00:00Z"),
    });

    return lotesDisponibles(asTx(), PAN, BODEGA, HOY).then((lotes) => {
      expect(lotes.map((l) => l.id)).toEqual(["l-nuevo", "l-viejo"]);
    });
  });

  it("a igual vencimiento, el que llegó antes", async () => {
    tx.seedLot("l-b", PAN, BODEGA, 5, {
      expiresAt: dia(20),
      receivedAt: new Date("2026-09-05T00:00:00Z"),
    });
    tx.seedLot("l-a", PAN, BODEGA, 5, {
      expiresAt: dia(20),
      receivedAt: new Date("2026-09-02T00:00:00Z"),
    });

    const lotes = await lotesDisponibles(asTx(), PAN, BODEGA, HOY);
    expect(lotes.map((l) => l.id)).toEqual(["l-a", "l-b"]);
  });

  it("lo que no vence va al final: no urge", async () => {
    tx.seedLot("l-sin", PAN, BODEGA, 5, { expiresAt: null });
    tx.seedLot("l-con", PAN, BODEGA, 5, { expiresAt: dia(25) });

    const lotes = await lotesDisponibles(asTx(), PAN, BODEGA, HOY);
    expect(lotes.map((l) => l.id)).toEqual(["l-con", "l-sin"]);
  });

  it("no ofrece lo vencido", async () => {
    tx.seedLot("l-vencido", PAN, BODEGA, 8, { expiresAt: dia(10) });
    tx.seedLot("l-vigente", PAN, BODEGA, 8, { expiresAt: dia(20) });

    const lotes = await lotesDisponibles(asTx(), PAN, BODEGA, HOY);
    expect(lotes.map((l) => l.id)).toEqual(["l-vigente"]);
  });

  it("no ofrece lo bloqueado, pero sigue existiendo", async () => {
    tx.seedLot("l-bloq", PAN, BODEGA, 8, { expiresAt: dia(20), status: "BLOQUEADO" });

    expect(await lotesDisponibles(asTx(), PAN, BODEGA, HOY)).toHaveLength(0);
    expect(tx.lotById("l-bloq").quantity).toBe(8);
  });

  it("no ofrece lotes de otra bodega", async () => {
    // El error más fácil de cometer: asignar un lote que está en la panadería
    // para una venta que sale del mesón. El stock total cuadra y el de cada
    // bodega no.
    tx.seedLot("l-otra", PAN, OTRA_BODEGA, 50, { expiresAt: dia(12) });
    tx.seedLot("l-aqui", PAN, BODEGA, 3, { expiresAt: dia(30) });

    const lotes = await lotesDisponibles(asTx(), PAN, BODEGA, HOY);
    expect(lotes.map((l) => l.id)).toEqual(["l-aqui"]);
  });

  it("no ofrece lotes agotados", async () => {
    tx.seedLot("l-cero", PAN, BODEGA, 0, { expiresAt: dia(12) });
    expect(await lotesDisponibles(asTx(), PAN, BODEGA, HOY)).toHaveLength(0);
  });
});

describe("el lote que vence hoy todavía se vende", () => {
  it("sigue disponible aunque ya pasó la hora del vencimiento", async () => {
    // El vencimiento es un DÍA, no un instante. Guardado a las 12:00 UTC
    // —09:00 en Chile—, compararlo contra la hora actual sacaba el pan del
    // día de circulación a media mañana, con el pan sobre el mesón y la
    // pantalla diciendo "vence hoy, vigente".
    tx.seedLot("l-hoy", PAN, BODEGA, 50, {
      expiresAt: new Date("2026-09-11T12:00:00Z"),
    });

    const aLasDiezYMedia = new Date("2026-09-11T13:30:00Z");
    const lotes = await lotesDisponibles(asTx(), PAN, BODEGA, aLasDiezYMedia);
    expect(lotes.map((l) => l.id)).toEqual(["l-hoy"]);
  });

  it("y deja de venderse recién al día siguiente", async () => {
    tx.seedLot("l-hoy", PAN, BODEGA, 50, {
      expiresAt: new Date("2026-09-11T12:00:00Z"),
    });

    const manana = new Date("2026-09-12T13:00:00Z");
    expect(await lotesDisponibles(asTx(), PAN, BODEGA, manana)).toHaveLength(0);
  });

  it("marcarVencidos tampoco se adelanta", async () => {
    tx.seedLot("l-hoy", PAN, BODEGA, 50, {
      expiresAt: new Date("2026-09-11T12:00:00Z"),
    });

    expect(await marcarVencidos(asTx(), new Date("2026-09-11T23:00:00Z"))).toBe(0);
    expect(await marcarVencidos(asTx(), new Date("2026-09-12T13:00:00Z"))).toBe(1);
  });

  it("de noche en Chile el conteo de días no se adelanta", async () => {
    // A las 22:00 del 11 en Chile ya es el 12 en UTC. Contando el día UTC,
    // todo el turno de la tarde veía los vencimientos corridos un día.
    const nocheDelOnce = new Date("2026-09-12T01:00:00Z");
    expect(diasHastaVencer(dia(12), nocheDelOnce)).toBe(1);
  });
});

describe("un producto con lotes no se puede mover sin lote", () => {
  it("applyMovement lo rechaza en vez de descuadrar en silencio", async () => {
    // Este es el agujero por el que la producción creaba 200 panes sin lote
    // y la primera venta fallaba diciendo que no había lotes. Fallar acá
    // convierte un desajuste mudo en un error en el momento exacto.
    tx.seedVariant(PAN, { tracksLots: true });

    await expect(
      applyMovement(asTx(), {
        variantId: PAN,
        warehouseId: BODEGA,
        type: "MERMA",
        delta: -1,
        userId: USER,
      })
    ).rejects.toBeInstanceOf(LotRequiredError);

    expect(tx.movements).toHaveLength(0);
    expect(tx.levelFor(PAN, BODEGA)).toBe(0);
  });

  it("con lote sí pasa", async () => {
    tx.seedVariant(PAN, { tracksLots: true });
    tx.seedLot("l1", PAN, BODEGA, 10, { expiresAt: dia(20) });

    await applyMovement(asTx(), {
      variantId: PAN,
      warehouseId: BODEGA,
      type: "MERMA",
      delta: -2,
      userId: USER,
      lotId: "l1",
    });

    expect(tx.lotById("l1").quantity).toBe(8);
    expect(tx.levelFor(PAN, BODEGA)).toBe(8);
  });

  it("un producto sin lotes se mueve como siempre", async () => {
    const ARROZ = "v-arroz";
    await applyMovement(asTx(), {
      variantId: ARROZ,
      warehouseId: BODEGA,
      type: "ENTRADA",
      delta: 20,
      userId: USER,
    });
    expect(tx.levelFor(ARROZ, BODEGA)).toBe(20);
  });
});

describe("repartirFefo", () => {
  const lotes = [
    { id: "a", code: "A", expiresAt: dia(12), receivedAt: dia(1), quantity: 3 },
    { id: "b", code: "B", expiresAt: dia(20), receivedAt: dia(2), quantity: 10 },
  ];

  it("agota el primero antes de tocar el segundo", () => {
    const { asignaciones, faltante } = repartirFefo(lotes, 5);
    expect(asignaciones).toEqual([
      { lotId: "a", code: "A", expiresAt: dia(12), cantidad: 3 },
      { lotId: "b", code: "B", expiresAt: dia(20), cantidad: 2 },
    ]);
    expect(faltante).toBe(0);
  });

  it("con un solo lote suficiente no parte la venta", () => {
    const { asignaciones } = repartirFefo(lotes, 2);
    expect(asignaciones).toHaveLength(1);
    expect(asignaciones[0].lotId).toBe("a");
  });

  it("reporta lo que falta en vez de inventarlo", () => {
    const { asignaciones, faltante } = repartirFefo(lotes, 20);
    expect(asignaciones).toHaveLength(2);
    expect(faltante).toBe(7);
  });

  it("reparte cantidades decimales sin perder gramos", () => {
    const porPeso = [
      { id: "a", code: "A", expiresAt: dia(12), receivedAt: dia(1), quantity: 0.4 },
      { id: "b", code: "B", expiresAt: dia(20), receivedAt: dia(2), quantity: 1 },
    ];
    const { asignaciones, faltante } = repartirFefo(porPeso, 0.75);
    expect(asignaciones.map((a) => a.cantidad)).toEqual([0.4, 0.35]);
    expect(faltante).toBe(0);
  });

  it("la cola binaria no inventa ni pierde una milésima", () => {
    // 0,1 + 0,2 en punto flotante da 0,30000000000000004. Sin redondear en
    // cada paso, el reparto dejaría un faltante fantasma y la venta se
    // rechazaría por cuatro diezmilésimas de gramo.
    const finos = [
      { id: "a", code: "A", expiresAt: dia(12), receivedAt: dia(1), quantity: 0.1 },
      { id: "b", code: "B", expiresAt: dia(20), receivedAt: dia(2), quantity: 0.2 },
    ];
    const { asignaciones, faltante } = repartirFefo(finos, 0.3);
    expect(faltante).toBe(0);
    expect(asignaciones.reduce((acc, a) => acc + a.cantidad, 0)).toBe(0.30000000000000004);
    expect(asignaciones.map((a) => a.cantidad)).toEqual([0.1, 0.2]);
  });

  it("pedir cero no asigna nada", () => {
    expect(repartirFefo(lotes, 0).asignaciones).toHaveLength(0);
  });
});

describe("consumirFefo", () => {
  it("escribe un movimiento por lote y deja los dos snapshots al día", async () => {
    tx.seedLot("l1", PAN, BODEGA, 3, { code: "L-01", expiresAt: dia(12) });
    tx.seedLot("l2", PAN, BODEGA, 10, { code: "L-02", expiresAt: dia(20) });

    const { asignaciones, movimientos } = await consumirFefo(asTx(), {
      variantId: PAN,
      warehouseId: BODEGA,
      cantidad: 5,
      type: "SALIDA",
      userId: USER,
      ahora: HOY,
    });

    expect(asignaciones).toHaveLength(2);
    expect(movimientos).toHaveLength(2);

    // El lote es un corte del mismo stock: los dos snapshots bajan.
    expect(tx.lotById("l1").quantity).toBe(0);
    expect(tx.lotById("l2").quantity).toBe(8);
    expect(tx.levelFor(PAN, BODEGA)).toBe(8);

    // Y cada lote sigue siendo la suma de sus propios movimientos.
    expect(tx.lotById("l1").quantity).toBe(3 + tx.lotSumFor("l1"));
    expect(tx.lotById("l2").quantity).toBe(10 + tx.lotSumFor("l2"));
  });

  it("el movimiento deja anotado de qué lote salió", async () => {
    tx.seedLot("l1", PAN, BODEGA, 5, { code: "L-01", expiresAt: dia(12) });

    const { movimientos } = await consumirFefo(asTx(), {
      variantId: PAN,
      warehouseId: BODEGA,
      cantidad: 2,
      type: "SALIDA",
      userId: USER,
      ahora: HOY,
    });

    expect((movimientos[0] as any).lotId).toBe("l1");
    expect(movimientos[0].reason).toContain("L-01");
  });

  it("si no alcanza no despacha nada", async () => {
    tx.seedLot("l1", PAN, BODEGA, 2, { expiresAt: dia(12) });

    await expect(
      tx.inTransaction(() =>
        consumirFefo(asTx(), {
          variantId: PAN,
          warehouseId: BODEGA,
          cantidad: 5,
          type: "SALIDA",
          userId: USER,
          ahora: HOY,
        })
      )
    ).rejects.toBeInstanceOf(InsufficientLotStockError);

    expect(tx.lotById("l1").quantity).toBe(2);
    expect(tx.movements).toHaveLength(0);
  });

  it("no despacha de un lote vencido aunque haya stock", async () => {
    // Es el caso que justifica todo: hay mercadería, pero no se puede vender.
    tx.seedLot("l-vencido", PAN, BODEGA, 100, { expiresAt: dia(10) });

    await expect(
      tx.inTransaction(() =>
        consumirFefo(asTx(), {
          variantId: PAN,
          warehouseId: BODEGA,
          cantidad: 1,
          type: "SALIDA",
          userId: USER,
          ahora: HOY,
        })
      )
    ).rejects.toBeInstanceOf(InsufficientLotStockError);
  });

  it("rechaza una cantidad que no es positiva", async () => {
    await expect(
      consumirFefo(asTx(), {
        variantId: PAN,
        warehouseId: BODEGA,
        cantidad: 0,
        type: "SALIDA",
        userId: USER,
      })
    ).rejects.toThrow("INVALID_QUANTITY");
  });
});

describe("recibirLote", () => {
  it("crea el lote y su cantidad nace de un movimiento", async () => {
    const { lote } = await recibirLote(asTx(), {
      variantId: PAN,
      warehouseId: BODEGA,
      code: "L-99",
      cantidad: 40,
      expiresAt: dia(20),
      userId: USER,
    });

    expect(tx.lotById(lote.id).quantity).toBe(40);
    expect(tx.levelFor(PAN, BODEGA)).toBe(40);
    // La invariante desde el primer día: el snapshot es la suma del historial.
    expect(tx.lotById(lote.id).quantity).toBe(tx.lotSumFor(lote.id));
  });

  it("recibir dos veces el mismo lote suma, no duplica", async () => {
    // El proveedor manda la misma tanda en dos entregas y sigue siendo una
    // sola tanda, con un solo vencimiento.
    const primera = await recibirLote(asTx(), {
      variantId: PAN,
      warehouseId: BODEGA,
      code: "L-99",
      cantidad: 40,
      expiresAt: dia(20),
      userId: USER,
    });
    const segunda = await recibirLote(asTx(), {
      variantId: PAN,
      warehouseId: BODEGA,
      code: "L-99",
      cantidad: 10,
      expiresAt: dia(20),
      userId: USER,
    });

    expect(segunda.lote.id).toBe(primera.lote.id);
    expect(tx.lots).toHaveLength(1);
    expect(tx.lotById(primera.lote.id).quantity).toBe(50);
  });

  it("un vencimiento distinto para el mismo lote no se pisa en silencio", async () => {
    // O es un error de tipeo o no es el mismo lote. En los dos casos hay que
    // mirarlo, no elegir uno de los dos por defecto.
    await recibirLote(asTx(), {
      variantId: PAN,
      warehouseId: BODEGA,
      code: "L-99",
      cantidad: 40,
      expiresAt: dia(20),
      userId: USER,
    });

    await expect(
      recibirLote(asTx(), {
        variantId: PAN,
        warehouseId: BODEGA,
        code: "L-99",
        cantidad: 5,
        expiresAt: dia(25),
        userId: USER,
      })
    ).rejects.toThrow("LOT_EXPIRY_MISMATCH");
  });

  it("no se recibe contra un lote bloqueado", async () => {
    tx.seedLot("l-bloq", PAN, BODEGA, 5, { code: "L-77", status: "BLOQUEADO" });

    await expect(
      recibirLote(asTx(), {
        variantId: PAN,
        warehouseId: BODEGA,
        code: "L-77",
        cantidad: 5,
        userId: USER,
      })
    ).rejects.toBeInstanceOf(LotNotAvailableError);
  });

  it("exige número de lote", async () => {
    await expect(
      recibirLote(asTx(), {
        variantId: PAN,
        warehouseId: BODEGA,
        code: "   ",
        cantidad: 5,
        userId: USER,
      })
    ).rejects.toThrow("LOT_CODE_REQUIRED");
  });
});

describe("días y estado de vencimiento", () => {
  it("cuenta días completos, sin importar la hora", () => {
    // "Vence mañana" tiene que dar 1 a las nueve de la mañana y a las once
    // de la noche.
    expect(diasHastaVencer(dia(12), new Date("2026-09-11T09:00:00Z"))).toBe(1);
    expect(diasHastaVencer(dia(12), new Date("2026-09-11T23:00:00Z"))).toBe(1);
    expect(diasHastaVencer(dia(11), HOY)).toBe(0);
    expect(diasHastaVencer(dia(10), HOY)).toBe(-1);
    expect(diasHastaVencer(null, HOY)).toBeNull();
  });

  it("el umbral es por producto, no uno solo para todo el almacén", () => {
    // Al pan hay que avisarle el mismo día; a un tarro de conservas, un mes
    // antes. Con un número único, uno de los dos avisa mal siempre.
    const enTresDias = dia(14);
    expect(estadoVencimiento(enTresDias, 1, HOY)).toBe("VIGENTE");
    expect(estadoVencimiento(enTresDias, 30, HOY)).toBe("POR_VENCER");
  });

  it("sin umbral propio usa el valor por defecto, y el borde está incluido", () => {
    // Hoy es el 11. Con siete días de aviso, el 18 todavía avisa y el 19 ya
    // no: el límite se cuenta hacia adentro.
    expect(DIAS_POR_VENCER_POR_DEFECTO).toBe(7);
    expect(estadoVencimiento(dia(14), null, HOY)).toBe("POR_VENCER");
    expect(estadoVencimiento(dia(18), null, HOY)).toBe("POR_VENCER");
    expect(estadoVencimiento(dia(19), null, HOY)).toBe("VIGENTE");
    expect(estadoVencimiento(dia(30), null, HOY)).toBe("VIGENTE");
  });

  it("lo vencido es vencido y lo que no vence no es ninguna de las dos", () => {
    expect(estadoVencimiento(dia(10), 7, HOY)).toBe("VENCIDO");
    expect(estadoVencimiento(null, 7, HOY)).toBe("SIN_VENCIMIENTO");
  });

  it("propone el vencimiento desde la vida útil declarada", () => {
    // Mediodía de Chile del 11: dos días de vida útil vencen el 13.
    const sugerido = vencimientoSugerido(2, new Date("2026-09-11T15:00:00Z"));
    expect(sugerido?.toISOString().slice(0, 10)).toBe("2026-09-13");
    expect(vencimientoSugerido(null)).toBeNull();
    expect(vencimientoSugerido(0)).toBeNull();
  });

  it("la vida útil se cuenta desde el día chileno, no desde el del servidor", () => {
    // Las 22:00 del 11 en Chile son ya el 12 en UTC. Contando el día UTC, el
    // pan que se recibe de noche proponía pasado mañana: justo el turno en
    // que se recibe el pan del día siguiente.
    const nocheDelOnce = new Date("2026-09-12T01:00:00Z");
    expect(vencimientoSugerido(1, nocheDelOnce)?.toISOString().slice(0, 10)).toBe("2026-09-12");
  });
});

describe("marcarVencidos", () => {
  it("saca de circulación lo vencido sin descontarlo", async () => {
    // Lo vencido sigue en la bodega hasta que alguien lo bote, y botarlo es
    // una merma que se registra a mano y con su motivo.
    tx.seedLot("l-vencido", PAN, BODEGA, 12, { expiresAt: dia(10) });
    tx.seedLot("l-vigente", PAN, BODEGA, 5, { expiresAt: dia(30) });

    const marcados = await marcarVencidos(asTx(), HOY);

    expect(marcados).toBe(1);
    expect(tx.lotById("l-vencido").status).toBe("VENCIDO");
    expect(tx.lotById("l-vencido").quantity).toBe(12);
    expect(tx.lotById("l-vigente").status).toBe("DISPONIBLE");
  });

  it("no toca lotes agotados", async () => {
    tx.seedLot("l-cero", PAN, BODEGA, 0, { expiresAt: dia(10) });
    expect(await marcarVencidos(asTx(), HOY)).toBe(0);
  });
});
