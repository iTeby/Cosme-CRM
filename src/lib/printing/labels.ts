import { baseEan13, completarEan13, simbologiaDe } from "./barcode";
import { COLUMNAS_58MM, EscPos } from "./escpos";
import { formatCurrency } from "../utils";
import { formatQuantity } from "../decimal";
import type { Numeric } from "../decimal";

// Etiquetas de producto.
//
// Dos formatos, porque son dos máquinas distintas: ZPL es el lenguaje de las
// Zebra y similares, que imprimen sobre etiqueta adhesiva troquelada; ESC/POS
// es el de la impresora de boletas, que sirve para pegar un código en el
// estante cuando no hay etiquetadora. El contenido es el mismo.

export type DatosEtiqueta = {
  sku: string;
  barcode: string | null;
  nombre: string;
  precio: Numeric;
  unidad?: string | null;
  /** Lote y vencimiento, cuando el producto los tiene. */
  lote?: string | null;
  vence?: string | null;
};

export type OpcionesEtiqueta = {
  /** 203 dpi son 8 puntos por mm; 300 dpi, 12. */
  dpi?: 203 | 300;
  anchoMm?: number;
  altoMm?: number;
  /** Oscuridad del cabezal, de 0 a 30. */
  oscuridad?: number;
  copias?: number;
};

/** ZPL no tiene escape: un ^ o un ~ en el texto se interpreta como comando. */
function limpiarZpl(texto: string | null | undefined): string {
  return (texto ?? "").replace(/[\^~]/g, " ").trim();
}

/**
 * Etiqueta de producto en ZPL II.
 *
 * Las posiciones están pensadas para 50 x 30 mm, que es el rollo corriente
 * de góndola. Cambiar el tamaño cambia el lienzo pero no reacomoda los
 * elementos: para otro formato hay que rehacer las coordenadas.
 */
export function etiquetaProductoZpl(
  datos: DatosEtiqueta,
  opciones: OpcionesEtiqueta = {}
): string {
  const dpi = opciones.dpi ?? 203;
  const puntosPorMm = dpi === 300 ? 12 : 8;
  const escala = dpi === 300 ? 1.5 : 1;
  const e = (valor: number) => Math.round(valor * escala);

  const anchoPuntos = Math.round((opciones.anchoMm ?? 50) * puntosPorMm);
  const altoPuntos = Math.round((opciones.altoMm ?? 30) * puntosPorMm);
  const copias = Math.max(1, opciones.copias ?? 1);
  const oscuridad = opciones.oscuridad ?? 20;

  const nombre = limpiarZpl(datos.nombre);
  const sku = limpiarZpl(datos.sku);
  const unidad = limpiarZpl(datos.unidad) || "UN";
  const codigo = (datos.barcode ?? "").replace(/[\^~\s]/g, "");

  let zplCodigo = "";
  if (codigo) {
    if (simbologiaDe(codigo) === "EAN13") {
      // ^BEN calcula el verificador, así que recibe los 12 dígitos base.
      zplCodigo = `^FO${e(20)},${e(115)}^BY${e(2)},2.5,${e(50)}^BEN,${e(50)},Y,N^FD${baseEan13(codigo)}^FS`;
    } else {
      const modulo = codigo.length > 10 ? e(1) : e(2);
      zplCodigo = `^FO${e(20)},${e(115)}^BY${modulo},2.5,${e(50)}^BCN,${e(50)},Y,N,N^FD${codigo}^FS`;
    }
  }

  const pieLote =
    datos.lote || datos.vence
      ? `^FO${e(20)},${e(185)}^A0N,${e(14)},${e(14)}^FDLOTE: ${limpiarZpl(datos.lote) || "-"}  VENCE: ${limpiarZpl(datos.vence) || "-"}^FS`
      : "";

  return [
    "^XA",
    `^PW${anchoPuntos}`,
    `^LL${altoPuntos}`,
    `~SD${oscuridad}`,
    "^PON",
    // ^CI28 activa UTF-8, que es lo que deja imprimir la ñ y las tildes.
    "^CI28",
    `^FO${e(20)},${e(15)}^A0N,${e(22)},${e(22)}^FB${e(360)},2,0,L,0^FD${nombre}^FS`,
    `^FO${e(20)},${e(88)}^A0N,${e(16)},${e(16)}^FDSKU: ${sku} (${unidad})^FS`,
    zplCodigo,
    `^FO${e(250)},${e(120)}^A0N,${e(32)},${e(32)}^FD${formatCurrency(Number(datos.precio))}^FS`,
    pieLote,
    `^PQ${copias}`,
    "^XZ",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * La misma etiqueta en la impresora de boletas, para cuando no hay
 * etiquetadora. Sale en papel térmico continuo, no en adhesivo.
 */
export function etiquetaProductoEscPos(datos: DatosEtiqueta): Uint8Array {
  const p = new EscPos(COLUMNAS_58MM);
  const codigo = (datos.barcode ?? "").replace(/\s/g, "");

  p.init().align("CENTRO");

  p.size(1, 2).bold(true).line(datos.nombre).bold(false).size(1, 1);
  p.line(`SKU: ${datos.sku} (${datos.unidad || "UN"})`);
  p.size(2, 2).bold(true).line(formatCurrency(Number(datos.precio))).bold(false).size(1, 1);

  if (codigo) {
    p.feed(1);
    const simbologia = simbologiaDe(codigo);
    // Acá sí van los 13 dígitos: a diferencia de ZPL, GS k 67 espera el
    // código completo con su verificador.
    p.barcode(simbologia === "EAN13" ? completarEan13(codigo) : codigo, simbologia, 50);
  }

  if (datos.lote || datos.vence) {
    p.line(`Lote ${datos.lote || "-"}  Vence ${datos.vence || "-"}`);
  }

  return p.feed(2).cut().bytes();
}

/** Varias etiquetas en un solo envío a la Zebra. */
export function loteEtiquetasZpl(
  items: DatosEtiqueta[],
  opciones: OpcionesEtiqueta = {}
): string {
  return items.map((item) => etiquetaProductoZpl(item, opciones)).join("\n");
}

/** Etiqueta de báscula: producto pesado, con su peso y su precio final. */
export function etiquetaPesoEscPos(datos: DatosEtiqueta & { peso: Numeric; total: Numeric }): Uint8Array {
  const p = new EscPos(COLUMNAS_58MM);

  p.init().align("CENTRO");
  p.size(1, 2).bold(true).line(datos.nombre).bold(false).size(1, 1);
  p.separator();
  p.align("IZQUIERDA");
  p.row("Peso", formatQuantity(datos.peso, datos.unidad || "kg"));
  p.row("Precio", `${formatCurrency(Number(datos.precio))} / ${datos.unidad || "kg"}`);
  p.separator();
  p.align("CENTRO").size(2, 2).bold(true).line(formatCurrency(Number(datos.total)));
  p.bold(false).size(1, 1);

  if (datos.vence) p.line(`Vence ${datos.vence}`);

  return p.feed(2).cut().bytes();
}
