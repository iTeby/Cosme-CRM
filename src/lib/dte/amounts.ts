import { round2, type Numeric } from "../decimal";

// Los montos de un documento tributario.
//
// La boleta afecta (tipo 39) se emite con precios que YA incluyen IVA: lo que
// el cliente paga en el mostrador es el total. El neto y el IVA se deducen
// hacia atrás, y la regla del SII es deducir el neto y dejar el IVA como
// diferencia, no calcular los dos por separado. Calculados aparte, el neto
// más el IVA puede no dar el total por un peso, y esa boleta se rechaza.

/** Tasa de IVA en Chile. Si cambia, cambia acá y en ningún otro lado. */
export const TASA_IVA = 0.19;

export type DteAmounts = {
  /** Monto neto, sin IVA. */
  net: number;
  /** IVA, siempre total menos neto. */
  tax: number;
  /** Total del documento, en pesos enteros. */
  total: number;
  /**
   * Diferencia entre el total de la venta y el del documento, por el redondeo
   * a peso entero. Una venta por peso (0,75 kg x $3.990 = $2.992,5) no se
   * puede declarar con centavos: la boleta va en pesos. Se devuelve para
   * poder mostrarla, no para esconderla.
   */
  roundingDelta: number;
};

/**
 * Descompone el total bruto de una venta en neto, IVA y total.
 *
 * Todo en pesos enteros: el SII no acepta decimales en los montos de un DTE.
 */
export function dteAmountsFromGross(grossTotal: Numeric): DteAmounts {
  const bruto = round2(grossTotal);
  // Los montos del documento van en pesos enteros. Math.round basta acá
  // porque el valor ya viene redondeado a dos decimales y no hay medios
  // negativos: el total de una venta nunca es negativo.
  const total = Math.round(bruto);
  const net = Math.round(total / (1 + TASA_IVA));
  const tax = total - net;

  return { net, tax, total, roundingDelta: round2(total - bruto) };
}

/** Lo mismo para un documento exento: no hay IVA que separar. */
export function dteAmountsExempt(grossTotal: Numeric): DteAmounts {
  const bruto = round2(grossTotal);
  const total = Math.round(bruto);
  return { net: total, tax: 0, total, roundingDelta: round2(total - bruto) };
}

/**
 * Normaliza un RUT chileno a la forma que espera el SII: sin puntos, con
 * guion y el dígito verificador en mayúscula. "12.345.678-k" → "12345678-K".
 */
export function normalizarRut(rut: string | null | undefined): string {
  const limpio = String(rut ?? "")
    .replace(/[.\s]/g, "")
    .toUpperCase();
  if (!limpio) return "";
  if (limpio.includes("-")) return limpio;
  // Sin guion: el último carácter es el dígito verificador.
  return `${limpio.slice(0, -1)}-${limpio.slice(-1)}`;
}

/**
 * Verifica el dígito verificador (módulo 11).
 *
 * No es cosmético: un RUT con dígito malo lo rechaza el SII después de haber
 * consumido el folio, y ese folio no vuelve. Es mejor decirlo antes.
 */
export function rutValido(rut: string | null | undefined): boolean {
  const normalizado = normalizarRut(rut);
  const match = /^(\d{7,8})-([\dK])$/.exec(normalizado);
  if (!match) return false;

  const [, cuerpo, dv] = match;
  let suma = 0;
  let multiplicador = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }

  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? "0" : resto === 10 ? "K" : String(resto);
  return esperado === dv;
}

/** RUT genérico del SII para boletas sin identificar al comprador. */
export const RUT_CONSUMIDOR_FINAL = "66666666-6";
