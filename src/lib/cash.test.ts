import { describe, expect, it } from "vitest";
import {
  claimShiftForCashById,
  closeShift,
  currentShift,
  differenceLabel,
  differenceTone,
  expectedCash,
  NoOpenShiftError,
  openKeyFor,
  openShift,
  requireOpenShift,
  shiftTotals,
  ShiftAlreadyClosedError,
  ShiftAlreadyOpenError,
} from "./cash";
import { payOneSale, removePayment, ShiftClosedError, CashWithoutShiftError } from "./payments";
import { FakeTx } from "./test-support/fake-tx";

const tx = () => new FakeTx() as any;

describe("openShift", () => {
  it("abre el turno con su fondo y la llave de unicidad puesta", async () => {
    const t = tx();
    const turno = await openShift(t, { warehouseId: "b1", openingAmount: 20000, userId: "u1" });

    expect(turno.status).toBe("ABIERTO");
    expect(turno.openingAmount).toBe(20000);
    expect(turno.openKey).toBe(openKeyFor("cosme", "b1"));
  });

  it("rechaza un segundo turno abierto en la misma bodega", async () => {
    const t = tx();
    await openShift(t, { warehouseId: "b1", openingAmount: 0, userId: "u1" });

    await expect(
      openShift(t, { warehouseId: "b1", openingAmount: 0, userId: "u2" })
    ).rejects.toBeInstanceOf(ShiftAlreadyOpenError);

    expect(t.shifts.length).toBe(1);
  });

  it("deja abrir turno en otra bodega al mismo tiempo", async () => {
    const t = tx();
    await openShift(t, { warehouseId: "b1", openingAmount: 0, userId: "u1" });
    await openShift(t, { warehouseId: "b2", openingAmount: 0, userId: "u1" });

    expect(t.shifts.length).toBe(2);
  });

  it("rechaza un fondo negativo", async () => {
    const t = tx();
    await expect(
      openShift(t, { warehouseId: "b1", openingAmount: -1, userId: "u1" })
    ).rejects.toThrow("INVALID_OPENING_AMOUNT");
  });

  it("redondea el fondo a dos decimales, como la base", async () => {
    const t = tx();
    const turno = await openShift(t, {
      warehouseId: "b1",
      openingAmount: "20000.005",
      userId: "u1",
    });
    expect(turno.openingAmount).toBe(20000.01);
  });
});

describe("currentShift", () => {
  it("devuelve el turno abierto de esa bodega", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 10000);

    const turno = await currentShift(t, "b1");
    expect(turno?.id).toBe("t1");
  });

  it("devuelve null cuando la caja está cerrada", async () => {
    const t = tx();
    expect(await currentShift(t, "b1")).toBeNull();
  });

  it("no confunde la caja de otra bodega", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 10000);
    expect(await currentShift(t, "b2")).toBeNull();
  });
});

describe("requireOpenShift", () => {
  it("devuelve el id del turno abierto de esa bodega", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 0);
    expect(await requireOpenShift(t, "b1")).toBe("t1");
  });

  it("falla si no hay turno abierto", async () => {
    const t = tx();
    await expect(requireOpenShift(t, "b1")).rejects.toBeInstanceOf(NoOpenShiftError);
  });

  it("falla si el turno de esa bodega ya se cerró", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 0);
    await closeShift(t, "t1", { countedAmount: 0, userId: "u1" });

    await expect(requireOpenShift(t, "b1")).rejects.toBeInstanceOf(NoOpenShiftError);
  });
});

describe("claimShiftForCashById", () => {
  it("reclama el turno abierto y deja rastro en el contador del lock", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 0);

    expect(await claimShiftForCashById(t, "t1")).toBe(true);
    expect(await claimShiftForCashById(t, "t1")).toBe(true);
    expect(t.shiftById("t1").cashOps).toBe(2);
  });

  it("devuelve false si el turno ya está cerrado", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 0);
    await closeShift(t, "t1", { countedAmount: 0, userId: "u1" });

    expect(await claimShiftForCashById(t, "t1")).toBe(false);
  });

  it("devuelve false si el turno no existe", async () => {
    const t = tx();
    expect(await claimShiftForCashById(t, "fantasma")).toBe(false);
  });
});

describe("expectedCash", () => {
  it("es el fondo cuando no se cobró nada", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 15000);
    expect(await expectedCash(t, "t1")).toBe(15000);
  });

  it("suma solo el efectivo del turno", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 10000);
    t.seedSale("v1", "c1", 50000);

    await payOneSale(t, "v1", { amount: 5000, method: "EFECTIVO", shiftId: "t1", userId: "u1" });
    await payOneSale(t, "v1", { amount: 7000, method: "DEBITO", shiftId: "t1", userId: "u1" });
    await payOneSale(t, "v1", {
      amount: 3000,
      method: "TRANSFERENCIA",
      shiftId: "t1",
      userId: "u1",
    });

    // El débito y la transferencia no pasan por el cajón.
    expect(await expectedCash(t, "t1")).toBe(15000);
  });

  it("no cuenta el efectivo de otro turno", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 0);
    t.seedShift("t2", "b2", 0);
    t.seedSale("v1", "c1", 50000);

    await payOneSale(t, "v1", { amount: 9000, method: "EFECTIVO", shiftId: "t2", userId: "u1" });

    expect(await expectedCash(t, "t1")).toBe(0);
  });

  it("baja cuando se deshace un abono en efectivo del turno abierto", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 0);
    t.seedSale("v1", "c1", 50000);

    const pago = await payOneSale(t, "v1", {
      amount: 8000,
      method: "EFECTIVO",
      shiftId: "t1",
      userId: "u1",
    });
    expect(await expectedCash(t, "t1")).toBe(8000);

    await removePayment(t, pago.id);
    expect(await expectedCash(t, "t1")).toBe(0);
  });
});

describe("closeShift", () => {
  it("congela el arqueo y libera la llave de unicidad", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 10000);
    t.seedSale("v1", "c1", 50000);
    await payOneSale(t, "v1", { amount: 5000, method: "EFECTIVO", shiftId: "t1", userId: "u1" });

    const cerrado = await closeShift(t, "t1", { countedAmount: 15000, userId: "u2" });

    expect(cerrado.status).toBe("CERRADO");
    expect(cerrado.openKey).toBeNull();
    expect(cerrado.expectedAmount).toBe(15000);
    expect(cerrado.countedAmount).toBe(15000);
    expect(cerrado.difference).toBe(0);
    expect(cerrado.closedById).toBe("u2");
  });

  it("registra el faltante sin impedir el cierre", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 10000);
    t.seedSale("v1", "c1", 50000);
    await payOneSale(t, "v1", { amount: 5000, method: "EFECTIVO", shiftId: "t1", userId: "u1" });

    const cerrado = await closeShift(t, "t1", { countedAmount: 14500, userId: "u1" });

    expect(cerrado.difference).toBe(-500);
    expect(differenceLabel(cerrado.difference)).toBe("Faltante");
    expect(differenceTone(cerrado.difference)).toBe("critical");
  });

  it("registra el sobrante", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 10000);

    const cerrado = await closeShift(t, "t1", { countedAmount: 10300, userId: "u1" });

    expect(cerrado.difference).toBe(300);
    expect(differenceLabel(cerrado.difference)).toBe("Sobrante");
    expect(differenceTone(cerrado.difference)).toBe("warn");
  });

  it("cerrar dos veces el mismo turno falla la segunda", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 0);
    await closeShift(t, "t1", { countedAmount: 0, userId: "u1" });

    await expect(
      closeShift(t, "t1", { countedAmount: 999, userId: "u1" })
    ).rejects.toBeInstanceOf(ShiftAlreadyClosedError);

    // El segundo intento no pisa el arqueo del primero.
    expect(t.shiftById("t1").countedAmount).toBe(0);
  });

  it("falla si el turno no existe", async () => {
    const t = tx();
    await expect(closeShift(t, "nope", { countedAmount: 0, userId: "u1" })).rejects.toThrow(
      "SHIFT_NOT_FOUND"
    );
  });

  it("rechaza un conteo negativo", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 0);
    await expect(
      closeShift(t, "t1", { countedAmount: -100, userId: "u1" })
    ).rejects.toThrow("INVALID_COUNTED_AMOUNT");
    expect(t.shiftById("t1").status).toBe("ABIERTO");
  });

  it("después de cerrar se puede abrir un turno nuevo en la misma bodega", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 0);
    await closeShift(t, "t1", { countedAmount: 0, userId: "u1" });

    const nuevo = await openShift(t, { warehouseId: "b1", openingAmount: 5000, userId: "u1" });
    expect(nuevo.status).toBe("ABIERTO");
  });

  it("el esperado guardado no cambia si después se toca el historial", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 0);
    t.seedSale("v1", "c1", 50000);
    const pago = await payOneSale(t, "v1", {
      amount: 4000,
      method: "DEBITO",
      shiftId: "t1",
      userId: "u1",
    });

    const cerrado = await closeShift(t, "t1", { countedAmount: 0, userId: "u1" });
    expect(cerrado.expectedAmount).toBe(0);

    // Deshacer un pago que no era efectivo no reescribe el arqueo firmado.
    await removePayment(t, pago.id);
    expect(t.shiftById("t1").expectedAmount).toBe(0);
    expect(t.shiftById("t1").difference).toBe(0);
  });
});

describe("shiftTotals", () => {
  it("desglosa lo cobrado por medio de pago", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 0);
    t.seedSale("v1", "c1", 100000);

    await payOneSale(t, "v1", { amount: 5000, method: "EFECTIVO", shiftId: "t1", userId: "u1" });
    await payOneSale(t, "v1", { amount: 2500, method: "EFECTIVO", shiftId: "t1", userId: "u1" });
    await payOneSale(t, "v1", { amount: 7000, method: "DEBITO", shiftId: "t1", userId: "u1" });

    const totales = await shiftTotals(t, "t1");

    expect(totales.porMedio.EFECTIVO).toBe(7500);
    expect(totales.porMedio.DEBITO).toBe(7000);
    expect(totales.efectivo).toBe(7500);
    expect(totales.total).toBe(14500);
  });

  it("un turno sin cobros da cero en todo", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 0);

    const totales = await shiftTotals(t, "t1");
    expect(totales.total).toBe(0);
    expect(totales.efectivo).toBe(0);
    expect(Object.keys(totales.porMedio).length).toBe(0);
  });
});

describe("el efectivo exige turno", () => {
  it("payOneSale rechaza efectivo sin turno", async () => {
    const t = tx();
    t.seedSale("v1", "c1", 10000);

    await expect(
      payOneSale(t, "v1", { amount: 1000, method: "EFECTIVO", userId: "u1" })
    ).rejects.toBeInstanceOf(CashWithoutShiftError);

    // Y no deja la venta con el saldo bajado: la guarda va antes de escribir.
    expect(t.saleById("v1").paidAmount).toBe(0);
  });

  it("los otros medios no exigen turno", async () => {
    const t = tx();
    t.seedSale("v1", "c1", 10000);

    await payOneSale(t, "v1", { amount: 1000, method: "TRANSFERENCIA", userId: "u1" });
    expect(t.saleById("v1").paidAmount).toBe(1000);
    expect(t.paidSumFor("v1")).toBe(1000);
  });
});

describe("cobrar en efectivo contra un turno que ya no está abierto", () => {
  it("rechaza el shiftId de un turno cerrado en vez de dejar la plata sin arqueo", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 0);
    await closeShift(t, "t1", { countedAmount: 0, userId: "u1" });
    t.seedSale("v1", "c1", 10000);

    await expect(
      payOneSale(t, "v1", { amount: 2000, method: "EFECTIVO", shiftId: "t1", userId: "u1" })
    ).rejects.toBeInstanceOf(ShiftClosedError);

    // Ni pago, ni saldo tocado, ni arqueo reescrito.
    expect(t.payments.length).toBe(0);
    expect(t.saleById("v1").paidAmount).toBe(0);
    expect(t.shiftById("t1").expectedAmount).toBe(0);
  });

  it("rechaza un shiftId que no existe", async () => {
    const t = tx();
    t.seedSale("v1", "c1", 10000);

    await expect(
      payOneSale(t, "v1", { amount: 2000, method: "EFECTIVO", shiftId: "fantasma", userId: "u1" })
    ).rejects.toBeInstanceOf(ShiftClosedError);
  });
});

describe("shiftTotals cuenta las ventas del turno", () => {
  it("cuenta solo las ventas atadas a ese turno", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 0);
    t.seedShift("t2", "b2", 0);
    t.seedSale("v1", "c1", 1000, { shiftId: "t1" });
    t.seedSale("v2", "c1", 2000, { shiftId: "t1" });
    t.seedSale("v3", "c1", 3000, { shiftId: "t2" });
    t.seedSale("v4", "c1", 4000);

    expect((await shiftTotals(t, "t1")).ventas).toBe(2);
    expect((await shiftTotals(t, "t2")).ventas).toBe(1);
  });
});

describe("deshacer un abono contra un turno cerrado", () => {
  it("no se puede deshacer efectivo ya arqueado", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 0);
    t.seedSale("v1", "c1", 10000);
    const pago = await payOneSale(t, "v1", {
      amount: 3000,
      method: "EFECTIVO",
      shiftId: "t1",
      userId: "u1",
    });
    await closeShift(t, "t1", { countedAmount: 3000, userId: "u1" });

    await expect(removePayment(t, pago.id)).rejects.toBeInstanceOf(ShiftClosedError);

    // Ni el pago ni el saldo de la venta se tocan.
    expect(t.payments.length).toBe(1);
    expect(t.saleById("v1").paidAmount).toBe(3000);
  });

  it("sí se puede mientras el turno sigue abierto", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 0);
    t.seedSale("v1", "c1", 10000);
    const pago = await payOneSale(t, "v1", {
      amount: 3000,
      method: "EFECTIVO",
      shiftId: "t1",
      userId: "u1",
    });

    await removePayment(t, pago.id);
    expect(t.saleById("v1").paidAmount).toBe(0);
    expect(t.paidSumFor("v1")).toBe(0);
  });

  it("un abono en efectivo sin turno sí se puede deshacer", async () => {
    // Son los que dejó la migración del eje de pagos: nunca entraron en un
    // arqueo, así que no hay ningún cuadre que proteger.
    const t = tx();
    t.seedSale("v1", "c1", 10000);
    t.payments.push({
      id: "viejo",
      customerId: "c1",
      saleId: "v1",
      shiftId: null,
      amount: 3000,
      method: "EFECTIVO",
      notes: null,
      createdById: "u1",
    });
    t.saleById("v1").paidAmount = 3000;

    await removePayment(t, "viejo");
    expect(t.saleById("v1").paidAmount).toBe(0);
  });

  it("un abono que no fue en efectivo se puede deshacer aunque el turno cerró", async () => {
    const t = tx();
    t.seedShift("t1", "b1", 0);
    t.seedSale("v1", "c1", 10000);
    const pago = await payOneSale(t, "v1", {
      amount: 3000,
      method: "DEBITO",
      shiftId: "t1",
      userId: "u1",
    });
    await closeShift(t, "t1", { countedAmount: 0, userId: "u1" });

    await removePayment(t, pago.id);
    expect(t.saleById("v1").paidAmount).toBe(0);
  });
});
