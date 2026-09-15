import { describe, expect, it } from "vitest";
import { fechaGs1, GS, parseGs1 } from "./gs1";

// El código largo de la caja del proveedor trae el producto, el lote y el
// vencimiento. Leerlo bien es lo que evita teclear una fecha por cada caja.

describe("fechas GS1", () => {
  it("lee AAMMDD", () => {
    expect(fechaGs1("260930")?.toISOString().slice(0, 10)).toBe("2026-09-30");
  });

  it("día 00 significa fin de mes, no fecha inválida", () => {
    // Es como GS1 dice "vence a fin de mes". Tomarlo como día cero daría el
    // último día del mes ANTERIOR: un mes entero de diferencia.
    expect(fechaGs1("260200")?.toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(fechaGs1("260900")?.toISOString().slice(0, 10)).toBe("2026-09-30");
  });

  it("arma la fecha en UTC", () => {
    // Con el constructor local, en Chile el vencimiento queda corrido un día
    // respecto de cómo se compara después, y un lote aparece vencido una
    // jornada antes de tiempo.
    expect(fechaGs1("260930")?.toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });

  it("rechaza lo que no es una fecha", () => {
    expect(fechaGs1("261332")).toBeUndefined();
    expect(fechaGs1("260231")).toBeUndefined();
    expect(fechaGs1("26093")).toBeUndefined();
    expect(fechaGs1("abcdef")).toBeUndefined();
  });
});

describe("lectura con paréntesis", () => {
  it("saca producto, vencimiento y lote", () => {
    const r = parseGs1("(01)07801234567890(17)260930(10)ABC123");
    expect(r.gtin).toBe("07801234567890");
    expect(r.ean13).toBe("7801234567890");
    expect(r.vence?.toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(r.lote).toBe("ABC123");
  });

  it("acepta el vencimiento como consumo preferente", () => {
    expect(parseGs1("(15)261001").vence?.toISOString().slice(0, 10)).toBe("2026-10-01");
  });
});

describe("lectura cruda, como la emite el lector", () => {
  it("corta los identificadores de largo fijo por su largo", () => {
    const r = parseGs1("010780123456789017260930");
    expect(r.gtin).toBe("07801234567890");
    expect(r.vence?.toISOString().slice(0, 10)).toBe("2026-09-30");
  });

  it("respeta el separador FNC1 después de un campo variable", () => {
    // Sin esto, el lote se come todo lo que venga detrás: "ABC12317260930"
    // en vez de "ABC123" más el vencimiento.
    const r = parseGs1(`0107801234567890${""}10ABC123${GS}17260930`);
    expect(r.lote).toBe("ABC123");
    expect(r.vence?.toISOString().slice(0, 10)).toBe("2026-09-30");
  });

  it("un campo variable al final termina donde termina el código", () => {
    const r = parseGs1("010780123456789017260930" + "10LOTE-FINAL");
    expect(r.lote).toBe("LOTE-FINAL");
  });

  it("lee el número de serie", () => {
    const r = parseGs1(`010780123456789021SER-9${GS}10L1`);
    expect(r.serie).toBe("SER-9");
    expect(r.lote).toBe("L1");
  });
});

describe("peso variable", () => {
  it("el último dígito del identificador dice dónde va la coma", () => {
    // Sin interpretarlo, 3103001250 se leería como 1250 kilos en vez de
    // 1,250. En una balanza de mostrador eso es mil veces el precio.
    expect(parseGs1("3103001250").pesoKg).toBe(1.25);
    expect(parseGs1("3102001250").pesoKg).toBe(12.5);
    expect(parseGs1("3100001250").pesoKg).toBe(1250);
  });

  it("convive con el resto del código", () => {
    const r = parseGs1(`01078012345678903103000750${GS}10L-7`);
    expect(r.pesoKg).toBe(0.75);
    expect(r.lote).toBe("L-7");
    expect(r.ean13).toBe("7801234567890");
  });
});

describe("bordes", () => {
  it("un código vacío no revienta", () => {
    expect(parseGs1("").crudos).toEqual({});
    expect(parseGs1("   ").crudos).toEqual({});
  });

  it("un GTIN de agrupación no se toma como EAN-13 de la unidad", () => {
    // Un GTIN-14 que no empieza en 0 es la caja o el pallet, no la unidad
    // que se vende: confundirlos asignaría el código de la caja al producto.
    const r = parseGs1("(01)17801234567890");
    expect(r.gtin).toBe("17801234567890");
    expect(r.ean13).toBeUndefined();
  });

  it("guarda lo que no interpreta en vez de descartarlo", () => {
    const r = parseGs1(`(01)07801234567890(99)LOQUESEA`);
    expect(r.crudos["99"]).toBe("LOQUESEA");
  });

  it("una fecha imposible se ignora sin arrastrar el resto", () => {
    const r = parseGs1("(17)269999(10)L-1");
    expect(r.vence).toBeUndefined();
    expect(r.lote).toBe("L-1");
  });
});
