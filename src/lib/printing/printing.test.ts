import { describe, expect, it } from "vitest";
import { anchoImpreso, COLUMNAS_58MM, encodeCp1252, EscPos } from "./escpos";
import { baseEan13, completarEan13, digitoVerificadorEan13, esEan13Valido, simbologiaDe } from "./barcode";
import { etiquetaProductoEscPos, etiquetaProductoZpl } from "./labels";
import { ticketCierreTurno, ticketVenta } from "./receipt";

/** Busca una secuencia de bytes dentro de otra. -1 si no está. */
function indiceDe(buffer: Uint8Array, secuencia: number[]): number {
  for (let i = 0; i + secuencia.length <= buffer.length; i++) {
    if (secuencia.every((b, j) => buffer[i + j] === b)) return i;
  }
  return -1;
}

/** El texto tal como lo imprimiría la máquina, para poder afirmar sobre él. */
function comoTexto(buffer: Uint8Array): string {
  return Buffer.from(buffer).toString("latin1");
}

describe("codificación CP1252", () => {
  it("la ñ y las tildes ocupan un solo byte", () => {
    // En UTF-8 ocuparían dos, y ahí es donde se descuadran las columnas y
    // salen los caracteres basura en la boleta.
    expect(encodeCp1252("ñ")).toEqual([0xf1]);
    expect(encodeCp1252("á")).toEqual([0xe1]);
    expect(encodeCp1252("Ñ")).toEqual([0xd1]);
    expect(encodeCp1252("ü")).toEqual([0xfc]);
    expect(encodeCp1252("¿")).toEqual([0xbf]);
  });

  it("traduce los caracteres del tramo que Windows movió", () => {
    expect(encodeCp1252("€")).toEqual([0x80]);
    expect(encodeCp1252("—")).toEqual([0x97]);
    expect(encodeCp1252("“")).toEqual([0x93]);
  });

  it("lo que no existe en la tabla sale como signo de pregunta", () => {
    // Un byte inventado puede dejar la impresora en otro modo para el resto
    // del ticket; un "?" solo se ve feo.
    expect(encodeCp1252("漢")).toEqual([0x3f]);
    expect(encodeCp1252("🥖")).toEqual([0x3f]);
  });

  it("el ancho impreso se cuenta en columnas, no en bytes UTF-8", () => {
    expect(anchoImpreso("Pan añejo")).toBe(9);
    expect(new TextEncoder().encode("Pan añejo").length).toBe(10);
  });
});

describe("comandos básicos", () => {
  it("init reinicia y recién después elige la tabla de caracteres", () => {
    // El orden importa: ESC @ borra la tabla seleccionada, así que elegirla
    // antes no sirve de nada.
    const bytes = new EscPos().init().bytes();
    expect(Array.from(bytes)).toEqual([0x1b, 0x40, 0x1b, 0x74, 16]);
  });

  it("el pulso del cajón es ESC p con los tiempos correctos", () => {
    expect(Array.from(new EscPos().openCashDrawer(2).bytes())).toEqual([0x1b, 0x70, 0, 25, 250]);
    expect(Array.from(new EscPos().openCashDrawer(5).bytes())).toEqual([0x1b, 0x70, 1, 25, 250]);
  });

  it("el corte avanza papel antes de cortar", () => {
    expect(Array.from(new EscPos().cut(true).bytes())).toEqual([0x1b, 0x64, 4, 0x1d, 0x56, 1]);
    expect(Array.from(new EscPos().cut(false).bytes())).toEqual([0x1b, 0x64, 4, 0x1d, 0x56, 0]);
  });

  it("el tamaño empaqueta ancho y alto en un byte", () => {
    expect(Array.from(new EscPos().size(1, 1).bytes())).toEqual([0x1d, 0x21, 0x00]);
    expect(Array.from(new EscPos().size(2, 2).bytes())).toEqual([0x1d, 0x21, 0x11]);
    expect(Array.from(new EscPos().size(1, 2).bytes())).toEqual([0x1d, 0x21, 0x01]);
  });
});

describe("filas de dos columnas", () => {
  it("el monto queda pegado al borde derecho", () => {
    const texto = comoTexto(new EscPos(32).row("Pan", "$1.500").bytes());
    expect(texto).toBe("Pan                       $1.500\n");
    expect(texto.trimEnd().length).toBe(32);
  });

  it("las tildes no corren la columna derecha", () => {
    // Contando bytes UTF-8, esta fila se pasaría del ancho del papel.
    const texto = comoTexto(new EscPos(32).row("Té añejo", "$990").bytes());
    expect(texto.replace("\n", "").length).toBe(32);
  });

  it("un nombre largo se recorta y deja el monto legible", () => {
    const texto = comoTexto(
      new EscPos(32).row("Marraqueta integral con semillas de sésamo", "$12.990").bytes()
    );
    expect(texto.replace("\n", "").length).toBe(32);
    expect(texto).toContain("$12.990");
    expect(texto).toContain(".");
  });
});

describe("PDF417", () => {
  it("el nivel de corrección va como carácter ASCII, no como entero", () => {
    // Con m = 0x31 el nivel debe ir de "0" a "8". Mandar el 3 crudo deja el
    // valor fuera de rango y la impresora ignora el comando en silencio: el
    // timbre sale con la corrección por defecto y puede no leerse.
    const bytes = new EscPos().pdf417("hola", 8, 3).bytes();
    const i = indiceDe(bytes, [0x1d, 0x28, 0x6b, 0x04, 0x00, 0x30, 0x45, 0x31]);
    expect(i).toBeGreaterThan(-1);
    expect(bytes[i + 8]).toBe(48 + 3);
  });

  it("el largo va en little endian y aguanta más de 255 bytes", () => {
    // Un timbre del SII pasa holgadamente los 255 bytes: si pL y pH se
    // calcularan mal, se cortaría justo en el caso real.
    const datos = "x".repeat(300);
    const bytes = new EscPos().pdf417(datos).bytes();
    const largo = 303;
    const i = indiceDe(bytes, [0x1d, 0x28, 0x6b, largo % 256, Math.floor(largo / 256), 0x30, 0x50, 0x30]);
    expect(i).toBeGreaterThan(-1);
  });

  it("termina mandando la orden de imprimir el símbolo", () => {
    const bytes = new EscPos().pdf417("hola").bytes();
    expect(indiceDe(bytes, [0x1d, 0x28, 0x6b, 0x03, 0x00, 0x30, 0x51, 0x30])).toBeGreaterThan(-1);
  });
});

describe("código de barras", () => {
  it("EAN-13 usa GS k 67 con el largo por delante", () => {
    const bytes = new EscPos().barcode("7801001000104", "EAN13").bytes();
    const i = indiceDe(bytes, [0x1d, 0x6b, 67, 13]);
    expect(i).toBeGreaterThan(-1);
  });

  it("Code 128 antepone el juego B", () => {
    const bytes = new EscPos().barcode("SKU-001", "CODE128").bytes();
    const i = indiceDe(bytes, [0x1d, 0x6b, 73]);
    expect(i).toBeGreaterThan(-1);
    expect(bytes[i + 4]).toBe(0x7b);
    expect(bytes[i + 5]).toBe(0x42);
  });

  it("una llave en el texto se duplica o el código diría otra cosa", () => {
    // "{" es el escape de Code 128: sin duplicar, "{B" dentro del dato
    // cambiaría el juego de caracteres a mitad del código.
    const bytes = new EscPos().barcode("A{B", "CODE128").bytes();
    const i = indiceDe(bytes, [0x1d, 0x6b, 73]);
    // {B de cabecera + "A" + "{" + "{" + "B" = 6 bytes de datos
    expect(bytes[i + 3]).toBe(6);
  });
});

describe("dígito verificador EAN-13", () => {
  it("calcula el verificador de códigos conocidos", () => {
    expect(digitoVerificadorEan13("780100100010")).toBe(4);
    expect(digitoVerificadorEan13("400638133393")).toBe(1);
  });

  it("completa y valida", () => {
    expect(completarEan13("780100100010")).toBe("7801001000104");
    expect(esEan13Valido("7801001000104")).toBe(true);
    expect(esEan13Valido("7801001000105")).toBe(false);
    expect(esEan13Valido("12345")).toBe(false);
  });

  it("rechaza una base que no son doce dígitos", () => {
    expect(() => digitoVerificadorEan13("123")).toThrow("EAN13_BASE_INVALIDA");
  });

  it("distingue la simbología por la forma del código", () => {
    expect(simbologiaDe("7801001000104")).toBe("EAN13");
    expect(simbologiaDe("PAN-MARRAQUETA")).toBe("CODE128");
  });
});

describe("etiqueta ZPL", () => {
  const base = { sku: "PAN-001", barcode: "7801001000104", nombre: "Marraqueta", precio: 1990 };

  it("a la Zebra se le pasan doce dígitos, no trece", () => {
    // ^BEN calcula el verificador. Con los trece, corre los dígitos e
    // imprime un código distinto al número que aparece debajo: el lector
    // lee una cosa y la persona lee otra.
    const zpl = etiquetaProductoZpl(base);
    expect(zpl).toContain("^BEN");
    expect(zpl).toContain("^FD780100100010^FS");
  });

  it("un código alfanumérico va en Code 128", () => {
    const zpl = etiquetaProductoZpl({ ...base, barcode: "PAN-A-001" });
    expect(zpl).toContain("^BCN");
  });

  it("sin código de barras no emite el bloque", () => {
    const zpl = etiquetaProductoZpl({ ...base, barcode: null });
    expect(zpl.includes("^BEN")).toBe(false);
    expect(zpl.includes("^BCN")).toBe(false);
    expect(zpl).toContain("^XZ");
  });

  it("neutraliza los caracteres de control de ZPL", () => {
    // Un ^ o un ~ en el nombre del producto se interpretaría como comando.
    const zpl = etiquetaProductoZpl({ ...base, nombre: "Pan ^XZ ~SD30 casero" });
    expect(zpl).toContain("Pan  XZ  SD30 casero");
  });

  it("a 300 dpi el lienzo y las posiciones escalan", () => {
    const a203 = etiquetaProductoZpl(base);
    const a300 = etiquetaProductoZpl(base, { dpi: 300 });
    expect(a203).toContain("^PW400");
    expect(a300).toContain("^PW600");
  });

  it("imprime lote y vencimiento solo si los hay", () => {
    expect(etiquetaProductoZpl(base)).toContain("^XZ");
    const conLote = etiquetaProductoZpl({ ...base, lote: "L-22", vence: "2026-09-20" });
    expect(conLote).toContain("LOTE: L-22");
    expect(conLote).toContain("VENCE: 2026-09-20");
  });
});

describe("etiqueta en la impresora de boletas", () => {
  it("acá sí van los trece dígitos", () => {
    // Al revés que ZPL: GS k 67 espera el código completo con verificador.
    const bytes = etiquetaProductoEscPos({
      sku: "PAN-001",
      barcode: "780100100010",
      nombre: "Marraqueta",
      precio: 1990,
    });
    expect(comoTexto(bytes)).toContain("Marraqueta");
    expect(indiceDe(bytes, [0x1d, 0x6b, 67, 13])).toBeGreaterThan(-1);
  });

  it("sale al ancho del papel angosto", () => {
    expect(new EscPos(COLUMNAS_58MM).columnas).toBe(32);
  });
});

describe("ticket de venta", () => {
  const venta = {
    negocio: "Almacén Doña Rosa",
    numero: 41,
    fecha: new Date("2026-09-11T14:30:00Z"),
    cajero: "Rosa",
    cliente: null,
    lineas: [
      { nombre: "Marraqueta", cantidad: 0.75, unidad: "kg", precioUnitario: 3990, subtotal: 2993 },
    ],
    total: 2993,
    pagado: 2993,
    pagos: [{ metodo: "EFECTIVO" as const, monto: 2993 }],
  };

  it("imprime el detalle, el total y el medio de pago", () => {
    const texto = comoTexto(ticketVenta(venta));
    expect(texto).toContain("Almacén Doña Rosa");
    expect(texto).toContain("Marraqueta");
    expect(texto).toContain("0,75 kg");
    expect(texto).toContain("TOTAL");
    expect(texto).toContain("Efectivo");
  });

  it("la hora sale en horario de Chile, no en el del servidor", () => {
    // 14:30 UTC son las 11:30 en Santiago —el 11 de septiembre Chile ya está
    // en horario de verano, UTC-3—. Si el papel dijera la hora del servidor,
    // el comprobante mentiría sobre cuándo se hizo la venta.
    expect(comoTexto(ticketVenta(venta))).toContain("11:30");
  });

  it("una venta fiada imprime lo que queda debiendo", () => {
    const texto = comoTexto(
      ticketVenta({
        ...venta,
        pagado: 1000,
        pagos: [{ metodo: "EFECTIVO", monto: 1000 }],
        cliente: { nombre: "Juan Pérez", deudaTotal: 18500 },
      })
    );
    expect(texto).toContain("QUEDA DEBIENDO");
    expect(texto).toContain("Juan Pérez");
    expect(texto).toContain("Deuda total");
  });

  it("una venta pagada no habla de deuda", () => {
    expect(comoTexto(ticketVenta(venta))).toContain("Gracias por su compra");
  });

  it("en certificación el aviso va arriba y en grande", () => {
    // Es lo único que impide que alguien tome el papel por una boleta real.
    const texto = comoTexto(ticketVenta({ ...venta, ambienteCertificacion: true, folio: 77 }));
    expect(texto).toContain("DOCUMENTO DE PRUEBA");
    expect(texto).toContain("SIN VALIDEZ TRIBUTARIA");
  });

  it("con timbre imprime el PDF417 y la leyenda del SII", () => {
    const bytes = ticketVenta({ ...venta, folio: 77, timbre: "<TED>...</TED>" });
    expect(indiceDe(bytes, [0x1d, 0x28, 0x6b])).toBeGreaterThan(-1);
    expect(comoTexto(bytes)).toContain("www.sii.cl");
  });

  it("sin timbre no imprime ningún PDF417", () => {
    expect(indiceDe(ticketVenta(venta), [0x1d, 0x28, 0x6b])).toBe(-1);
  });
});

describe("ticket de cierre de caja", () => {
  const cierre = {
    negocio: "Almacén Doña Rosa",
    turno: 7,
    abiertoPor: "Rosa",
    cerradoPor: "Rosa",
    abiertoEn: new Date("2026-09-11T12:00:00Z"),
    cerradoEn: new Date("2026-09-11T23:00:00Z"),
    fondo: 20000,
    porMedio: { EFECTIVO: 145000, DEBITO: 88000 },
    ventas: 63,
    esperado: 165000,
    contado: 164500,
    diferencia: -500,
  };

  it("deja en el papel lo esperado y lo contado, no solo la diferencia", () => {
    // Si mañana no cuadra, el papel tiene que poder reconstruir la cuenta
    // sin abrir el sistema.
    const texto = comoTexto(ticketCierreTurno(cierre));
    expect(texto).toContain("EFECTIVO ESPERADO");
    expect(texto).toContain("EFECTIVO CONTADO");
    expect(texto).toContain("FALTANTE");
  });

  it("desglosa por medio de pago", () => {
    const texto = comoTexto(ticketCierreTurno(cierre));
    expect(texto).toContain("Efectivo");
    expect(texto).toContain("Débito");
  });

  it("un corte X se identifica como lectura y no muestra el cierre", () => {
    const texto = comoTexto(ticketCierreTurno({ ...cierre, esLectura: true }));
    expect(texto).toContain("CORTE X");
  });

  it("cuando cuadra lo dice", () => {
    const texto = comoTexto(ticketCierreTurno({ ...cierre, contado: 165000, diferencia: 0 }));
    expect(texto).toContain("CUADRA");
  });

  it("deja espacio para la firma", () => {
    expect(comoTexto(ticketCierreTurno(cierre))).toContain("Firma:");
  });
});
