import { describe, expect, it } from "vitest";
import {
  DteAlreadyIssuedError,
  DteInFlightError,
  DteIndeterminateError,
  DteNotIssuableError,
  idempotencyKeyFor,
  prepararDte,
  registrarResultado,
} from "./issue";
import { FakeTx } from "../test-support/fake-tx";

// Lo que se prueba acá es una sola cosa: que una venta no consuma dos folios.
// Es el único error de este módulo que cuesta plata y trámite —cada folio de
// más es una nota de crédito— y es el que no se puede verificar mirando la
// pantalla.

const BASE = {
  tipo: "BOLETA" as const,
  environment: "CERTIFICACION",
  provider: "simulado",
};

function conVenta(total = 10000) {
  const tx = new FakeTx();
  tx.seedSale("v1", "c1", total);
  // El doble no modela el include de cliente y líneas, así que se completa.
  const venta = tx.saleById("v1") as any;
  venta.customer = { id: "c1", name: "Ana Pérez", taxId: "12345678-5" };
  venta.items = [
    {
      quantity: 2,
      unitPrice: total / 2,
      variant: { product: { name: "Pan batido" } },
    },
  ];
  return tx;
}

const claveDe = (saleId = "v1") =>
  idempotencyKeyFor("cosme", "CERTIFICACION", "BOLETA", saleId);

describe("prepararDte", () => {
  it("crea la fila en PENDIENTE antes de llamar a nadie", async () => {
    const tx = conVenta() as any;
    const { dte, emitInput } = await prepararDte(tx, { ...BASE, saleId: "v1" });

    expect(dte.status).toBe("PENDIENTE");
    expect(dte.idempotencyKey).toBe(claveDe());
    expect(emitInput.total).toBe(10000);
    expect(emitInput.neto + emitInput.iva).toBe(emitInput.total);
  });

  it("no emite sobre una venta anulada", async () => {
    const tx = conVenta() as any;
    tx.saleById("v1").status = "ANULADA";

    await expect(prepararDte(tx, { ...BASE, saleId: "v1" })).rejects.toBeInstanceOf(
      DteNotIssuableError
    );
    expect(tx.dtes.length).toBe(0);
  });

  it("no emite si el total da cero", async () => {
    const tx = conVenta(0) as any;
    await expect(prepararDte(tx, { ...BASE, saleId: "v1" })).rejects.toBeInstanceOf(
      DteNotIssuableError
    );
  });

  it("no emite si el documento no calza con el total de la venta", async () => {
    const tx = conVenta(10000) as any;
    // Las líneas suman 10.000 pero la cabecera dice otra cosa: eso no es
    // redondeo, es una inconsistencia, y la boleta declararía un monto
    // distinto al cobrado.
    tx.saleById("v1").totalAmount = 25000;

    await expect(prepararDte(tx, { ...BASE, saleId: "v1" })).rejects.toBeInstanceOf(
      DteNotIssuableError
    );
    expect(tx.dtes.length).toBe(0);
  });
});

describe("una venta no consume dos folios", () => {
  it("con un documento ENVIADO no se emite otro", async () => {
    const tx = conVenta() as any;
    tx.seedDte({ idempotencyKey: claveDe(), saleId: "v1", status: "ENVIADO", folio: 1042 });

    await expect(prepararDte(tx, { ...BASE, saleId: "v1" })).rejects.toBeInstanceOf(
      DteAlreadyIssuedError
    );
    expect(tx.dtes.length).toBe(1);
  });

  it("con un documento ACEPTADO tampoco", async () => {
    const tx = conVenta() as any;
    tx.seedDte({ idempotencyKey: claveDe(), saleId: "v1", status: "ACEPTADO", folio: 7 });

    await expect(prepararDte(tx, { ...BASE, saleId: "v1" })).rejects.toBeInstanceOf(
      DteAlreadyIssuedError
    );
  });

  it("una boleta viva bloquea también emitir una factura de la misma venta", async () => {
    // La clave de idempotencia incluye el tipo, así que sin la guarda por
    // venta un POST a mano con tipo FACTURA pasaba de largo.
    const tx = conVenta() as any;
    tx.seedDte({
      idempotencyKey: claveDe(),
      saleId: "v1",
      status: "ACEPTADO",
      type: "BOLETA",
      folio: 7,
    });

    await expect(
      prepararDte(tx, { ...BASE, saleId: "v1", tipo: "FACTURA" })
    ).rejects.toBeInstanceOf(DteAlreadyIssuedError);
    expect(tx.dtes.length).toBe(1);
  });

  it("un PENDIENTE recién creado es una emisión en curso, no un reintento", async () => {
    const tx = conVenta() as any;
    tx.seedDte({ idempotencyKey: claveDe(), saleId: "v1", status: "PENDIENTE" });

    await expect(prepararDte(tx, { ...BASE, saleId: "v1" })).rejects.toBeInstanceOf(
      DteInFlightError
    );
  });

  it("un PENDIENTE viejo sí se puede reintentar: ese proceso murió", async () => {
    const tx = conVenta() as any;
    tx.seedDte({
      idempotencyKey: claveDe(),
      saleId: "v1",
      status: "PENDIENTE",
      updatedAt: new Date(Date.now() - 5 * 60_000),
    });

    const { dte } = await prepararDte(tx, { ...BASE, saleId: "v1" });
    expect(dte.status).toBe("PENDIENTE");
    // Reusa la fila, no crea una segunda.
    expect(tx.dtes.length).toBe(1);
  });

  it("un ERROR firme se reintenta al instante", async () => {
    const tx = conVenta() as any;
    tx.seedDte({
      idempotencyKey: claveDe(),
      saleId: "v1",
      status: "ERROR",
      errorMessage: "RUT del emisor inválido",
    });

    const { dte } = await prepararDte(tx, { ...BASE, saleId: "v1" });
    expect(dte.status).toBe("PENDIENTE");
    expect(dte.errorMessage).toBeNull();
    expect(tx.dtes.length).toBe(1);
  });

  it("un INDETERMINADO NO se reintenta solo", async () => {
    // Este es el caso que emitía el segundo folio: la llamada se cortó por
    // tiempo, el proveedor emitió igual, y el botón invitaba a repetir.
    const tx = conVenta() as any;
    tx.seedDte({ idempotencyKey: claveDe(), saleId: "v1", status: "INDETERMINADO" });

    await expect(prepararDte(tx, { ...BASE, saleId: "v1" })).rejects.toBeInstanceOf(
      DteIndeterminateError
    );
    expect(tx.dtes.length).toBe(1);
  });
});

describe("registrarResultado", () => {
  it("un envío bueno queda ENVIADO, no ACEPTADO", async () => {
    // El proveedor lo recibió; el SII todavía no dijo nada. Marcarlo como
    // aceptado sería afirmar algo que nadie afirmó.
    const tx = conVenta() as any;
    const { dte } = await prepararDte(tx, { ...BASE, saleId: "v1" });

    const fila = await registrarResultado(tx, dte.id, {
      ok: true,
      folio: 1042,
      trackId: "tk-1",
      raw: "{}",
    });

    expect(fila.status).toBe("ENVIADO");
    expect(fila.folio).toBe(1042);
    expect(fila.issuedAt).toBeTruthy();
  });

  it("un fallo firme queda en ERROR y se puede reintentar", async () => {
    const tx = conVenta() as any;
    const { dte } = await prepararDte(tx, { ...BASE, saleId: "v1" });

    const fila = await registrarResultado(tx, dte.id, {
      ok: false,
      error: "RUT inválido",
    });
    expect(fila.status).toBe("ERROR");

    const reintento = await prepararDte(tx, { ...BASE, saleId: "v1" });
    expect(reintento.dte.id).toBe(dte.id);
  });

  it("un fallo sin confirmar queda en INDETERMINADO y bloquea el reintento", async () => {
    const tx = conVenta() as any;
    const { dte } = await prepararDte(tx, { ...BASE, saleId: "v1" });

    const fila = await registrarResultado(tx, dte.id, {
      ok: false,
      indeterminado: true,
      error: "El proveedor no respondió en 20 segundos",
    });
    expect(fila.status).toBe("INDETERMINADO");

    await expect(prepararDte(tx, { ...BASE, saleId: "v1" })).rejects.toBeInstanceOf(
      DteIndeterminateError
    );
  });
});

describe("receptor identificado", () => {
  it("exige RUT válido cuando la boleta va a nombre del cliente", async () => {
    const tx = conVenta() as any;
    (tx.saleById("v1") as any).customer.taxId = "12.345.678-9";

    await expect(
      prepararDte(tx, { ...BASE, saleId: "v1", identificarReceptor: true })
    ).rejects.toBeInstanceOf(DteNotIssuableError);
    expect(tx.dtes.length).toBe(0);
  });

  it("normaliza el RUT del cliente antes de mandarlo", async () => {
    const tx = conVenta() as any;
    (tx.saleById("v1") as any).customer.taxId = "12.345.678-5";

    const { emitInput } = await prepararDte(tx, {
      ...BASE,
      saleId: "v1",
      identificarReceptor: true,
    });
    expect(emitInput.receptor?.rut).toBe("12345678-5");
  });

  it("sin identificar receptor, el proveedor pone el RUT genérico", async () => {
    const tx = conVenta() as any;
    const { emitInput } = await prepararDte(tx, { ...BASE, saleId: "v1" });
    expect(emitInput.receptor).toBeNull();
  });
});
