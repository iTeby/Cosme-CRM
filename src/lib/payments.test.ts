import { describe, it, expect, beforeEach } from "vitest";
import {
  payOneSale,
  payAccount,
  removePayment,
  OverpaymentError,
  NothingToPayError,
  type Tx,
} from "./payments";
import { outstanding, paymentStateOf } from "./sales";
import { FakeTx } from "./test-support/fake-tx";

const CLIENTE = "cliente-1";
const USER = "usuario-1";
const TURNO = "turno-1";
// El turno lo resuelve quien llama —POST /api/payments, con
// claimOpenShiftForCash()— y llega ya resuelto acá. Que el efectivo lo exija
// se prueba en cash.test.ts; estos casos son sobre el reparto y la invariante.
const BASE = { method: "EFECTIVO" as const, userId: USER, shiftId: TURNO };

let tx: FakeTx;
const asTx = () => tx as unknown as Tx;

beforeEach(() => {
  tx = new FakeTx();
  // Con la caja abierta, que es la condición normal del mostrador. Que el
  // efectivo la exija —y que un turno cerrado lo rechace— se prueba en
  // cash.test.ts; acá el turno es contexto, no el sujeto.
  tx.seedShift(TURNO, "bodega-1", 0);
});

/** La invariante del fiado: lo abonado es siempre la suma de los pagos. */
function expectInvariant(saleId: string) {
  expect(tx.saleById(saleId).paidAmount).toBe(tx.paidSumFor(saleId));
}

describe("estado de pago derivado", () => {
  it("sin abonos está impaga", () => {
    expect(paymentStateOf(10000, 0)).toBe("IMPAGA");
    expect(outstanding(10000, 0)).toBe(10000);
  });

  it("con un abono parcial está abonada", () => {
    expect(paymentStateOf(10000, 4000)).toBe("PARCIAL");
    expect(outstanding(10000, 4000)).toBe(6000);
  });

  it("cuando los abonos cubren el total está pagada", () => {
    expect(paymentStateOf(10000, 10000)).toBe("PAGADA");
    expect(outstanding(10000, 10000)).toBe(0);
  });

  it("el saldo nunca es negativo", () => {
    expect(outstanding(10000, 12000)).toBe(0);
  });

  it("funciona con los valores como texto, que es como llegan al navegador", () => {
    expect(paymentStateOf("10000", "10000")).toBe("PAGADA");
    expect(outstanding("10000.50", "400.25")).toBe(9600.25);
  });
});

describe("payOneSale", () => {
  it("un abono parcial sube lo pagado y deja la venta abonada", async () => {
    tx.seedSale("v1", CLIENTE, 10000);
    await payOneSale(asTx(), "v1", { ...BASE, amount: 4000 });

    expect(tx.saleById("v1").paidAmount).toBe(4000);
    expect(tx.payments).toHaveLength(1);
    expect(paymentStateOf(10000, tx.saleById("v1").paidAmount)).toBe("PARCIAL");
    expectInvariant("v1");
  });

  it("dos abonos que suman el total dejan la venta pagada", async () => {
    tx.seedSale("v1", CLIENTE, 10000);
    await payOneSale(asTx(), "v1", { ...BASE, amount: 4000 });
    await payOneSale(asTx(), "v1", { ...BASE, amount: 6000 });

    expect(paymentStateOf(10000, tx.saleById("v1").paidAmount)).toBe("PAGADA");
    expect(tx.payments).toHaveLength(2);
    expectInvariant("v1");
  });

  it("rechaza el abono que deja la venta pagada de más, y no escribe nada", async () => {
    tx.seedSale("v1", CLIENTE, 10000, { paid: 8000 });
    await expect(
      tx.inTransaction(() => payOneSale(asTx(), "v1", { ...BASE, amount: 3000 }))
    ).rejects.toBeInstanceOf(OverpaymentError);

    expect(tx.saleById("v1").paidAmount).toBe(8000);
    expect(tx.payments).toHaveLength(0);
  });

  it("no se puede abonar a una venta anulada", async () => {
    tx.seedSale("v1", CLIENTE, 10000, { status: "ANULADA" });
    await expect(
      tx.inTransaction(() => payOneSale(asTx(), "v1", { ...BASE, amount: 1000 }))
    ).rejects.toMatchObject({ message: "SALE_VOIDED" });
    expect(tx.payments).toHaveLength(0);
  });

  it("rechaza montos que no son plata que entra", async () => {
    tx.seedSale("v1", CLIENTE, 10000);
    for (const amount of [0, -500]) {
      await expect(
        tx.inTransaction(() => payOneSale(asTx(), "v1", { ...BASE, amount }))
      ).rejects.toMatchObject({ message: "INVALID_AMOUNT" });
    }
    expect(tx.payments).toHaveLength(0);
  });

  it("guarda el medio de pago y la venta a la que corresponde", async () => {
    tx.seedSale("v1", CLIENTE, 5000);
    await payOneSale(asTx(), "v1", {
      ...BASE,
      method: "TRANSFERENCIA",
      amount: 5000,
      notes: "Pagó por el banco",
    });
    expect(tx.payments[0]).toMatchObject({
      saleId: "v1",
      customerId: CLIENTE,
      method: "TRANSFERENCIA",
      notes: "Pagó por el banco",
    });
  });
});

describe("payAccount — abono a cuenta", () => {
  it("se reparte de la venta más antigua a la más nueva", async () => {
    tx.seedSale("v1", CLIENTE, 3000, { order: 1 });
    tx.seedSale("v2", CLIENTE, 5000, { order: 2 });
    tx.seedSale("v3", CLIENTE, 4000, { order: 3 });

    await payAccount(asTx(), CLIENTE, { ...BASE, amount: 6000 });

    expect(tx.saleById("v1").paidAmount).toBe(3000);
    expect(tx.saleById("v2").paidAmount).toBe(3000);
    expect(tx.saleById("v3").paidAmount).toBe(0);
    expect(tx.payments).toHaveLength(2);
    expectInvariant("v1");
    expectInvariant("v2");
  });

  it("salta las ventas ya pagadas y las anuladas", async () => {
    tx.seedSale("v1", CLIENTE, 3000, { paid: 3000, order: 1 });
    tx.seedSale("v2", CLIENTE, 5000, { status: "ANULADA", order: 2 });
    tx.seedSale("v3", CLIENTE, 4000, { order: 3 });

    await payAccount(asTx(), CLIENTE, { ...BASE, amount: 4000 });

    expect(tx.saleById("v3").paidAmount).toBe(4000);
    expect(tx.saleById("v2").paidAmount).toBe(0);
    expect(tx.payments).toHaveLength(1);
  });

  it("un abono que supera toda la deuda se rechaza entero", async () => {
    tx.seedSale("v1", CLIENTE, 3000, { order: 1 });
    tx.seedSale("v2", CLIENTE, 2000, { order: 2 });

    await expect(
      tx.inTransaction(() => payAccount(asTx(), CLIENTE, { ...BASE, amount: 6000 }))
    ).rejects.toBeInstanceOf(OverpaymentError);

    // Nada quedó a medio aplicar.
    expect(tx.saleById("v1").paidAmount).toBe(0);
    expect(tx.saleById("v2").paidAmount).toBe(0);
    expect(tx.payments).toHaveLength(0);
  });

  it("un cliente sin deuda no puede abonar", async () => {
    tx.seedSale("v1", CLIENTE, 3000, { paid: 3000 });
    await expect(
      tx.inTransaction(() => payAccount(asTx(), CLIENTE, { ...BASE, amount: 1000 }))
    ).rejects.toBeInstanceOf(NothingToPayError);
    expect(tx.payments).toHaveLength(0);
  });

  it("un abono que cubre la deuda exacta deja todo pagado", async () => {
    tx.seedSale("v1", CLIENTE, 3000, { order: 1 });
    tx.seedSale("v2", CLIENTE, 2000, { order: 2 });

    await payAccount(asTx(), CLIENTE, { ...BASE, amount: 5000 });

    expect(paymentStateOf(3000, tx.saleById("v1").paidAmount)).toBe("PAGADA");
    expect(paymentStateOf(2000, tx.saleById("v2").paidAmount)).toBe("PAGADA");
    expectInvariant("v1");
    expectInvariant("v2");
  });

  it("reparte con decimales sin perder ni inventar un peso", async () => {
    tx.seedSale("v1", CLIENTE, 1000.55, { order: 1 });
    tx.seedSale("v2", CLIENTE, 2000.45, { order: 2 });

    await payAccount(asTx(), CLIENTE, { ...BASE, amount: 3001 });

    expect(tx.saleById("v1").paidAmount).toBe(1000.55);
    expect(tx.saleById("v2").paidAmount).toBe(2000.45);
    expect(tx.paidSumFor("v1") + tx.paidSumFor("v2")).toBe(3001);
  });
});

describe("removePayment", () => {
  it("deshace el pago y devuelve el saldo a la venta", async () => {
    tx.seedSale("v1", CLIENTE, 10000);
    const pago = await payOneSale(asTx(), "v1", { ...BASE, amount: 4000 });
    expect(tx.saleById("v1").paidAmount).toBe(4000);

    await removePayment(asTx(), pago.id);

    expect(tx.saleById("v1").paidAmount).toBe(0);
    expect(tx.payments).toHaveLength(0);
    expectInvariant("v1");
  });

  it("deshacer uno de varios abonos deja el resto en pie", async () => {
    tx.seedSale("v1", CLIENTE, 10000);
    const primero = await payOneSale(asTx(), "v1", { ...BASE, amount: 4000 });
    await payOneSale(asTx(), "v1", { ...BASE, amount: 2500 });

    await removePayment(asTx(), primero.id);

    expect(tx.saleById("v1").paidAmount).toBe(2500);
    expectInvariant("v1");
  });

  it("un pago que no existe no borra otro por error", async () => {
    tx.seedSale("v1", CLIENTE, 10000);
    await payOneSale(asTx(), "v1", { ...BASE, amount: 4000 });
    await expect(
      tx.inTransaction(() => removePayment(asTx(), "no-existe"))
    ).rejects.toMatchObject({ message: "PAYMENT_NOT_FOUND" });
    expect(tx.payments).toHaveLength(1);
  });
});

describe("invariante del fiado", () => {
  it("lo abonado sigue siendo la suma de los pagos tras una secuencia larga", async () => {
    tx.seedSale("v1", CLIENTE, 12000, { order: 1 });
    tx.seedSale("v2", CLIENTE, 8000, { order: 2 });

    await payOneSale(asTx(), "v1", { ...BASE, amount: 2000 });
    const borrable = await payOneSale(asTx(), "v1", { ...BASE, amount: 3000 });
    await payAccount(asTx(), CLIENTE, { ...BASE, amount: 5000 });
    await removePayment(asTx(), borrable.id);
    await payAccount(asTx(), CLIENTE, { ...BASE, amount: 1000 });

    expectInvariant("v1");
    expectInvariant("v2");
    const deuda =
      outstanding(12000, tx.saleById("v1").paidAmount) +
      outstanding(8000, tx.saleById("v2").paidAmount);
    expect(deuda).toBe(20000 - (2000 + 5000 + 1000));
  });
});
