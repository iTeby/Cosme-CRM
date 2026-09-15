import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  dteAmountsExempt,
  dteAmountsFromGross,
  normalizarRut,
  rutValido,
  TASA_IVA,
} from "./amounts";
import { dteConfig, motivoBloqueoProduccion } from "./config";
import { construirCuerpo, leerRespuesta } from "./openfactura";
import { codigoSii } from "./provider";
import { idempotencyKeyFor, lineasYMontos } from "./issue";

// El entorno mínimo para que la configuración se considere completa.
const EMISOR = {
  DTE_EMISOR_RUT: "76123456-7",
  DTE_EMISOR_RAZON_SOCIAL: "Cosme SpA",
  DTE_EMISOR_GIRO: "Venta al por menor",
  DTE_EMISOR_ACTECO: "471000",
  DTE_EMISOR_DIRECCION: "Calle Falsa 123",
  DTE_EMISOR_COMUNA: "Santiago",
};

describe("la baranda de ambiente", () => {
  it("sin nada configurado emite en certificación", () => {
    const config = dteConfig({});
    expect(config.environment).toBe("CERTIFICACION");
    expect(config.baseUrl).toBe("https://dev-api.haulmer.com");
  });

  it("pedir producción sin la frase no alcanza", () => {
    const config = dteConfig({ DTE_ENVIRONMENT: "PRODUCCION" });
    expect(config.environment).toBe("CERTIFICACION");
    expect(motivoBloqueoProduccion({ DTE_ENVIRONMENT: "PRODUCCION" })).toContain(
      "DTE_EMISOR_RUT"
    );
  });

  it("un true en la variable de habilitación no sirve", () => {
    // A propósito: un booleano se copia de otro proyecto sin leerlo.
    expect(
      dteConfig({
        DTE_ENVIRONMENT: "PRODUCCION",
        DTE_EMISOR_RUT: "76123456-7",
        DTE_ALLOW_PRODUCCION: "true",
      }).environment
    ).toBe("CERTIFICACION");
  });

  it("la frase de otra empresa tampoco sirve", () => {
    // Copiarla de un ejemplo o de otro proyecto no alcanza: lleva el RUT
    // de la empresa cuyos folios se van a gastar.
    expect(
      dteConfig({
        DTE_ENVIRONMENT: "PRODUCCION",
        DTE_EMISOR_RUT: "76123456-7",
        DTE_ALLOW_PRODUCCION: "si-entiendo-que-son-folios-reales-de-99999999-9",
      }).environment
    ).toBe("CERTIFICACION");
  });

  it("la frase genérica, sin RUT, tampoco", () => {
    expect(
      dteConfig({
        DTE_ENVIRONMENT: "PRODUCCION",
        DTE_EMISOR_RUT: "76123456-7",
        DTE_ALLOW_PRODUCCION: "si-entiendo-que-son-folios-reales",
      }).environment
    ).toBe("CERTIFICACION");
  });

  it("la frase exacta con el RUT correcto sí habilita producción", () => {
    const env = {
      DTE_ENVIRONMENT: "PRODUCCION",
      DTE_EMISOR_RUT: "76123456-7",
      DTE_ALLOW_PRODUCCION: "si-entiendo-que-son-folios-reales-de-76123456-7",
    };
    const config = dteConfig(env);
    expect(config.environment).toBe("PRODUCCION");
    expect(config.baseUrl).toBe("https://api.haulmer.com");
    expect(motivoBloqueoProduccion(env)).toBeNull();
  });

  it("una variante de mayúsculas o con espacios bloquea, no habilita", () => {
    // La comparación es exacta a propósito: falla cerrado.
    for (const valor of ["produccion", "Produccion", " PRODUCCION", "PRODUCCION ", "PRODUCCION\n"]) {
      expect(dteConfig({ DTE_ENVIRONMENT: valor }).environment).toBe("CERTIFICACION");
    }
  });

  it("no existe ninguna variable que cambie la URL base", () => {
    // La única defensa contra apuntar certificación al host real es que la
    // URL se derive del ambiente. Este test se rompe el día que alguien
    // agregue `baseUrl: env.LO_QUE_SEA ?? BASE_URLS[environment]`.
    const fuente = readFileSync(new URL("./config.ts", import.meta.url), "utf8");
    expect(fuente).toContain("baseUrl: BASE_URLS[environment],");
    // Y que no haya ninguna asignación de baseUrl que lea del entorno.
    expect(/baseUrl:\s*[^,\n]*\benv\b/.test(fuente)).toBe(false);
  });

  it("sin credencial se usa el proveedor simulado", () => {
    expect(dteConfig({}).provider).toBe("simulado");
  });

  it("con credencial se usa openfactura", () => {
    const env = { OPENFACTURA_API_KEY: "abc123", ...EMISOR };
    expect(dteConfig(env).provider).toBe("openfactura");
  });

  it("una credencial en blanco cuenta como no tenerla", () => {
    const env = { OPENFACTURA_API_KEY: "   " };
    expect(dteConfig(env).provider).toBe("simulado");
  });
});

describe("montos del documento", () => {
  it("neto más IVA siempre da el total", () => {
    for (let total = 1; total <= 5000; total++) {
      const m = dteAmountsFromGross(total);
      expect(m.net + m.tax).toBe(m.total);
    }
  });

  it("el IVA sale de deducir el neto, no de calcularlo aparte", () => {
    // 1000 / 1,19 = 840,336... → neto 840, IVA 160. Calculado aparte
    // (1000 x 0,19 = 190) daría 1030 de total y el SII lo rechazaría.
    const m = dteAmountsFromGross(1000);
    expect(m.net).toBe(840);
    expect(m.tax).toBe(160);
    expect(m.total).toBe(1000);
  });

  it("redondea el total a peso entero y dice cuánto movió", () => {
    const m = dteAmountsFromGross(2992.5);
    expect(m.total).toBe(2993);
    expect(m.roundingDelta).toBe(0.5);
  });

  it("un documento exento no separa IVA", () => {
    const m = dteAmountsExempt(1990);
    expect(m.net).toBe(1990);
    expect(m.tax).toBe(0);
    expect(m.total).toBe(1990);
  });

  it("la tasa es 19%", () => {
    expect(TASA_IVA).toBe(0.19);
  });
});

describe("líneas del documento", () => {
  it("el total es la suma de las líneas ya redondeadas", () => {
    // Cada línea redondea a peso; si el total se sacara de la venta, podría
    // diferir del detalle y el SII rechaza el documento.
    const r = lineasYMontos(
      [
        { quantity: 0.125, unitPrice: 1995, nombre: "Queso" },
        { quantity: 0.125, unitPrice: 1995, nombre: "Jamón" },
      ],
      "BOLETA",
      498.75
    );
    expect(r.lineas.map((l) => l.monto)).toEqual([249, 249]);
    expect(r.total).toBe(498);
    expect(r.net + r.tax).toBe(r.total);
  });

  it("reporta cuánto se alejó del total de la venta", () => {
    const r = lineasYMontos(
      [{ quantity: 0.75, unitPrice: 3990, nombre: "Queso" }],
      "BOLETA",
      2992.5
    );
    expect(r.total).toBe(2993);
    expect(r.roundingDelta).toBe(0.5);
  });

  it("el precio de la línea es el mismo con el que se calcula su monto", () => {
    // $1.990,50 x 10. Si PrcItem se redondeara a 1991 y el monto se calculara
    // con 1990,50, el documento declararía 19.905 y el detalle 19.910: el SII
    // valida esa relación y lo rechaza con el folio ya consumido.
    const r = lineasYMontos(
      [{ quantity: 10, unitPrice: 1990.5, nombre: "Queso" }],
      "BOLETA",
      19905
    );
    const linea = r.lineas[0];
    expect(Math.round(linea.cantidad * linea.precioUnitario)).toBe(linea.monto);
    expect(r.total).toBe(19905);
  });

  it("acepta cantidades y precios que llegan como string, que es como los manda Prisma", () => {
    const r = lineasYMontos(
      [{ quantity: "2", unitPrice: "1500", nombre: "Pan" }],
      "BOLETA",
      "3000"
    );
    expect(r.total).toBe(3000);
    expect(r.roundingDelta).toBe(0);
  });
});

describe("RUT", () => {
  it("normaliza puntos, espacios y minúsculas", () => {
    expect(normalizarRut("12.345.678-k")).toBe("12345678-K");
    expect(normalizarRut(" 76.123.456 - 7 ")).toBe("76123456-7");
  });

  it("le pone el guion si venía sin él", () => {
    expect(normalizarRut("123456785")).toBe("12345678-5");
  });

  it("vacío es vacío, no un guion suelto", () => {
    expect(normalizarRut(null)).toBe("");
    expect(normalizarRut("")).toBe("");
  });

  it("valida el dígito verificador", () => {
    expect(rutValido("12.345.678-5")).toBe(true);
    expect(rutValido("12.345.678-9")).toBe(false);
    expect(rutValido("66666666-6")).toBe(true);
    expect(rutValido("no-es-un-rut")).toBe(false);
    expect(rutValido("")).toBe(false);
  });
});

describe("cuerpo de la petición a OpenFactura", () => {
  const config = dteConfig({ OPENFACTURA_API_KEY: "k", ...EMISOR });

  const input = {
    tipo: "BOLETA" as const,
    referenciaInterna: "dte-1",
    receptor: null,
    lineas: [{ nombre: "Pan batido", cantidad: 2, precioUnitario: 1500, monto: 3000 }],
    neto: 2521,
    iva: 479,
    total: 3000,
  };

  it("usa el código del SII, no el nombre", () => {
    const cuerpo = construirCuerpo(config, input) as any;
    expect(cuerpo.dteJson.Encabezado.IdDoc.TipoDTE).toBe(39);
    expect(codigoSii.BOLETA).toBe(39);
  });

  it("usa el RUT genérico del SII cuando no se identifica al comprador", () => {
    // Receptor es obligatorio en el esquema del SII aunque la boleta sea a
    // consumidor final. Omitirlo hace rechazar el documento con el folio ya
    // consumido.
    const cuerpo = construirCuerpo(config, input) as any;
    expect(cuerpo.dteJson.Encabezado.Receptor.RUTRecep).toBe("66666666-6");
  });

  it("la boleta lleva IndServicio, obligatorio en el tipo 39", () => {
    const cuerpo = construirCuerpo(config, input) as any;
    expect(cuerpo.dteJson.Encabezado.IdDoc.IndServicio).toBe(3);
  });

  it("incluye el receptor cuando la boleta va a nombre del cliente", () => {
    const cuerpo = construirCuerpo(config, {
      ...input,
      receptor: { rut: "12345678-5", razonSocial: "Ana Pérez" },
    }) as any;
    expect(cuerpo.dteJson.Encabezado.Receptor.RUTRecep).toBe("12345678-5");
  });

  it("un documento exento lleva MntExe y no IVA", () => {
    const cuerpo = construirCuerpo(config, { ...input, tipo: "BOLETA_EXENTA" }) as any;
    expect(cuerpo.dteJson.Encabezado.Totales.MntExe).toBe(3000);
    expect(cuerpo.dteJson.Encabezado.Totales.IVA).toBeUndefined();
  });

  it("trunca el nombre del producto a 80 caracteres", () => {
    const largo = "x".repeat(200);
    const cuerpo = construirCuerpo(config, {
      ...input,
      lineas: [{ nombre: largo, cantidad: 1, precioUnitario: 100, monto: 100 }],
    }) as any;
    expect(cuerpo.dteJson.Detalle[0].NmbItem.length).toBe(80);
  });

  it("numera las líneas desde 1", () => {
    const cuerpo = construirCuerpo(config, {
      ...input,
      lineas: [
        { nombre: "A", cantidad: 1, precioUnitario: 100, monto: 100 },
        { nombre: "B", cantidad: 1, precioUnitario: 200, monto: 200 },
      ],
    }) as any;
    expect(cuerpo.dteJson.Detalle.map((d: any) => d.NroLinDet)).toEqual([1, 2]);
  });
});

describe("lectura de la respuesta del proveedor", () => {
  it("reconoce el folio", () => {
    const r = leerRespuesta(JSON.stringify({ FOLIO: 1234, TOKEN: "abc" }));
    expect(r.ok).toBe(true);
    expect(r.folio).toBe(1234);
    expect(r.trackId).toBe("abc");
  });

  it("acepta el folio como string numérico", () => {
    expect(leerRespuesta(JSON.stringify({ folio: "77" })).folio).toBe(77);
  });

  it("no inventa un éxito si no reconoce la forma, y lo marca indeterminado", () => {
    // El proveedor respondió 200: lo más probable es que el documento SÍ se
    // haya emitido. Tratarlo como un error a secas lo dejaría reintentable y
    // el segundo intento gastaría otro folio.
    const r = leerRespuesta(JSON.stringify({ algo: "distinto" }));
    expect(r.ok).toBe(false);
    expect(r.indeterminado).toBe(true);
    expect(r.raw).toContain("distinto");
    expect(r.error).toContain("portal");
  });

  it("falla claro si no es JSON", () => {
    const r = leerRespuesta("<html>error</html>");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no es JSON");
  });

  it("guarda el PDF solo si es una URL, no si es base64", () => {
    expect(leerRespuesta(JSON.stringify({ FOLIO: 1, PDF: "JVBERi0xLjQK" })).pdfUrl).toBeUndefined();
    expect(leerRespuesta(JSON.stringify({ FOLIO: 1, PDF: "https://x.cl/a.pdf" })).pdfUrl).toBe(
      "https://x.cl/a.pdf"
    );
  });
});

describe("clave de idempotencia", () => {
  it("distingue ambiente, tipo y venta", () => {
    const cert = idempotencyKeyFor("cosme", "CERTIFICACION", "BOLETA", "v1");
    const prod = idempotencyKeyFor("cosme", "PRODUCCION", "BOLETA", "v1");
    const otra = idempotencyKeyFor("cosme", "CERTIFICACION", "BOLETA", "v2");
    const exenta = idempotencyKeyFor("cosme", "CERTIFICACION", "BOLETA_EXENTA", "v1");

    expect(new Set([cert, prod, otra, exenta]).size).toBe(4);
  });

  it("la misma venta en el mismo ambiente da la misma clave", () => {
    expect(idempotencyKeyFor("cosme", "CERTIFICACION", "BOLETA", "v1")).toBe(
      idempotencyKeyFor("cosme", "CERTIFICACION", "BOLETA", "v1")
    );
  });
});
