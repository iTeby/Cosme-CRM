// Lectura de códigos GS1-128 / DataMatrix.
//
// El código de barras largo que traen las cajas del proveedor no es solo el
// producto: lleva también el lote y el vencimiento. Leerlo es lo que evita
// que alguien tenga que teclear una fecha por cada caja que entra, y sin eso
// el control de vencimiento no se sostiene en un mostrador con cola.
//
// El formato son pares de identificador y valor pegados sin separador. Los
// identificadores de largo fijo se cortan por su largo; los de largo
// variable terminan con el carácter FNC1, que el lector emite como GS
// (0x1D). Ignorar ese separador es el error clásico: un lote seguido de otro
// identificador se lee como un lote larguísimo que no existe.

/** El separador que el lector emite por FNC1. */
export const GS = "";

/**
 * Identificadores de largo fijo, con el largo de su valor.
 *
 * Los que no están acá son variables y terminan en GS o al final del código.
 */
const LARGO_FIJO: Record<string, number> = {
  "00": 18, // SSCC
  "01": 14, // GTIN
  "02": 14, // GTIN del contenido
  "11": 6, // fecha de producción
  "12": 6, // fecha de vencimiento de pago
  "13": 6, // fecha de envasado
  "15": 6, // consumir preferentemente antes de
  "16": 6, // fecha de venta
  "17": 6, // fecha de vencimiento
  "20": 2, // variante
};

/** Los identificadores de peso y medida son 310n..316n, con 6 dígitos. */
function esMedidaDecimal(ai: string): boolean {
  return /^3[12356]\d\d$/.test(ai) && ai.length === 4;
}

export type Gs1Parsed = {
  /** GTIN completo de 14 dígitos, tal como viene. */
  gtin?: string;
  /** El EAN-13 que corresponde, si el GTIN lo contiene. */
  ean13?: string;
  lote?: string;
  serie?: string;
  vence?: Date;
  produccion?: Date;
  /** Peso neto en kilos, cuando el código lo trae. */
  pesoKg?: number;
  cantidad?: number;
  /** Todo lo leído, incluido lo que no se interpreta. */
  crudos: Record<string, string>;
};

/**
 * Convierte YYMMDD a fecha.
 *
 * Dos detalles del estándar que son fáciles de perder:
 *
 *  - El día 00 significa el último día del mes. No es una fecha inválida ni
 *    el día cero: es como GS1 dice "vence a fin de mes".
 *  - La fecha se arma en UTC. Con el constructor local, en Chile un
 *    vencimiento queda desplazado un día respecto de cómo se compara
 *    después, y un lote aparece vencido una jornada antes de tiempo.
 */
export function fechaGs1(yymmdd: string): Date | undefined {
  if (!/^\d{6}$/.test(yymmdd)) return undefined;

  const anio = 2000 + Number(yymmdd.slice(0, 2));
  const mes = Number(yymmdd.slice(2, 4));
  const dia = Number(yymmdd.slice(4, 6));
  if (mes < 1 || mes > 12) return undefined;

  if (dia === 0) {
    // Día 0 del mes siguiente es el último del mes actual.
    return new Date(Date.UTC(anio, mes, 0));
  }
  if (dia > 31) return undefined;

  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  // Rechaza un 31 de febrero en vez de dejarlo correr al 3 de marzo.
  return fecha.getUTCMonth() === mes - 1 ? fecha : undefined;
}

/**
 * Lee un código GS1.
 *
 * Acepta las dos formas en que llega: con los identificadores entre
 * paréntesis, que es como se imprime para que lo lea una persona, y crudo
 * con separadores GS, que es como lo emite el lector.
 */
export function parseGs1(entrada: string): Gs1Parsed {
  const crudos: Record<string, string> = {};
  const texto = (entrada ?? "").trim();
  if (!texto) return { crudos };

  if (texto.includes("(")) {
    for (const match of texto.matchAll(/\((\d{2,4})\)([^(]*)/g)) {
      crudos[match[1]] = match[2].trim();
    }
    return interpretar(crudos);
  }

  let i = 0;
  while (i < texto.length) {
    // Un separador suelto entre elementos: se salta.
    if (texto[i] === GS) {
      i += 1;
      continue;
    }

    const dos = texto.slice(i, i + 2);
    const cuatro = texto.slice(i, i + 4);

    let ai: string;
    let largo: number | null;

    if (esMedidaDecimal(cuatro)) {
      ai = cuatro;
      largo = 6;
    } else if (LARGO_FIJO[dos] !== undefined) {
      ai = dos;
      largo = LARGO_FIJO[dos];
    } else {
      ai = dos;
      largo = null; // variable: hasta el GS o el final
    }

    i += ai.length;

    let valor: string;
    if (largo === null) {
      const fin = texto.indexOf(GS, i);
      valor = fin === -1 ? texto.slice(i) : texto.slice(i, fin);
      i = fin === -1 ? texto.length : fin + 1;
    } else {
      valor = texto.slice(i, i + largo);
      i += largo;
    }

    if (!valor) break;
    crudos[ai] = valor;
  }

  return interpretar(crudos);
}

function interpretar(crudos: Record<string, string>): Gs1Parsed {
  const salida: Gs1Parsed = { crudos };

  const gtin = crudos["01"] ?? crudos["02"];
  if (gtin) {
    salida.gtin = gtin;
    // Un GTIN-14 con el primer dígito en 0 contiene un EAN-13, que es lo que
    // guarda la variante. Los demás son agrupaciones —la caja, el pallet— y
    // no corresponden a la unidad de venta.
    if (gtin.length === 14 && gtin.startsWith("0")) salida.ean13 = gtin.slice(1);
    else if (gtin.length === 13) salida.ean13 = gtin;
  }

  if (crudos["10"]) salida.lote = crudos["10"];
  if (crudos["21"]) salida.serie = crudos["21"];

  const vence = crudos["17"] ?? crudos["15"];
  if (vence) {
    const fecha = fechaGs1(vence);
    if (fecha) salida.vence = fecha;
  }

  if (crudos["11"]) {
    const fecha = fechaGs1(crudos["11"]);
    if (fecha) salida.produccion = fecha;
  }

  // 310n es peso neto en kilos y la n dice cuántos decimales tiene el valor.
  // Sin esto, "3103001250" se leería como 1250 kilos en vez de 1,250.
  for (const [ai, valor] of Object.entries(crudos)) {
    if (/^310\d$/.test(ai) && /^\d{6}$/.test(valor)) {
      const decimales = Number(ai[3]);
      salida.pesoKg = Number(valor) / 10 ** decimales;
      break;
    }
  }

  if (crudos["30"] && /^\d+$/.test(crudos["30"])) {
    salida.cantidad = Number(crudos["30"]);
  }

  return salida;
}
