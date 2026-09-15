// Códigos de barras: dígito verificador y validación.
//
// El código de barras es el que viene impreso en el envase y lo pone el
// fabricante. No es el SKU: el SKU lo inventa el almacén. Ver el comentario
// de ProductVariant.barcode en el esquema.

/**
 * Dígito verificador de un EAN-13, por módulo 10.
 *
 * Se suman los dígitos de posición impar por 1 y los de par por 3; el
 * verificador es lo que falta para llegar a la decena. Recibe los 12
 * dígitos base y devuelve el decimotercero.
 */
export function digitoVerificadorEan13(doceDigitos: string): number {
  if (!/^\d{12}$/.test(doceDigitos)) {
    throw new Error("EAN13_BASE_INVALIDA");
  }

  let suma = 0;
  for (let i = 0; i < 12; i++) {
    suma += Number(doceDigitos[i]) * (i % 2 === 0 ? 1 : 3);
  }

  return (10 - (suma % 10)) % 10;
}

/** Completa un EAN-13 de 12 dígitos, o devuelve el de 13 tal cual. */
export function completarEan13(codigo: string): string {
  const limpio = codigo.replace(/\s/g, "");
  if (/^\d{12}$/.test(limpio)) return limpio + digitoVerificadorEan13(limpio);
  return limpio;
}

/** Si un código es un EAN-13 válido, verificador incluido. */
export function esEan13Valido(codigo: string): boolean {
  const limpio = codigo.replace(/\s/g, "");
  if (!/^\d{13}$/.test(limpio)) return false;
  return digitoVerificadorEan13(limpio.slice(0, 12)) === Number(limpio[12]);
}

/**
 * Los 12 dígitos base de un EAN-13, que es lo que espera la impresora Zebra.
 *
 * ZPL con ^BEN calcula el verificador solo. Si se le pasan los 13, corre los
 * dígitos e imprime un código distinto al que dice el número de abajo: el
 * lector lee una cosa y la persona lee otra, que es el peor de los errores
 * posibles en una etiqueta.
 */
export function baseEan13(codigo: string): string {
  const limpio = codigo.replace(/\s/g, "");
  return /^\d{13}$/.test(limpio) ? limpio.slice(0, 12) : limpio;
}

/**
 * Qué simbología corresponde a un código.
 *
 * Un código de 13 dígitos con el verificador malo NO es un EAN-13: mandarlo
 * como tal hace que ZPL recalcule el último dígito e imprima otro número,
 * mientras la impresora térmica directamente ignora el comando. Sale por
 * Code 128, que imprime exactamente lo que dice la base.
 */
export function simbologiaDe(codigo: string): "EAN13" | "CODE128" {
  const limpio = codigo.replace(/\s/g, "");
  if (/^\d{12}$/.test(limpio)) return "EAN13";
  if (/^\d{13}$/.test(limpio)) return esEan13Valido(limpio) ? "EAN13" : "CODE128";
  return "CODE128";
}
