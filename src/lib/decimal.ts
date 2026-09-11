// Las cantidades de inventario son Decimal en la base, porque se vende por
// peso: medio kilo de pan, 250 gramos de queso, un kilo y cuarto de arroz.
//
// Ese mismo valor llega de tres formas distintas según dónde esté el código:
//   - en un server component, como objeto Decimal de Prisma
//   - en un componente de cliente, como string (los server components serializan
//     con JSON.parse(JSON.stringify(...)) antes de pasar los datos)
//   - en un formulario, como string escrito por el usuario
//
// Sumar cualquiera de los dos últimos con + concatena en vez de sumar, y no
// lanza ningún error: el resultado sale mal y en silencio. Por eso toda
// aritmética y todo render de cantidades pasa por acá.

export type Numeric = number | string | { toString(): string } | null | undefined;

/** Normaliza a number cualquier cantidad, venga como venga. Nunca devuelve NaN. */
export function toNumber(value: Numeric): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Redondea a los tres decimales que guarda la base (Decimal(12,3)).
 *
 * Es obligatorio antes de escribir. Dos motivos: una receta escalada produce
 * fracciones largas (12,5 kg para 200 panes son 0,0625 por pan), y la
 * aritmética de punto flotante inventa colas (0,1 + 0,2 da 0,30000000000000004).
 * Si se escribe el valor largo, Postgres lo redondea al guardarlo pero el
 * snapshot que calculamos en memoria conserva la cola: el nivel y la suma del
 * historial se separan por milésimas, y ese desajuste crece con cada
 * movimiento.
 */
export function round3(value: Numeric): number {
  const n = toNumber(value);
  if (!Number.isFinite(n) || n === 0) return 0;

  // Se redondea sobre la representación decimal más corta del número, que es
  // la misma cadena que Prisma le manda a Postgres. Ni multiplicando por 1000
  // ni con toFixed() directo: los dos operan sobre el valor binario, que no
  // es exactamente el decimal que uno escribió.
  //
  // Ejemplo de por qué importa: 131,0715 se almacena en binario como
  // 131,07149999999998…, así que 131,0715 * 1000 da 131071,49999999999 y
  // toFixed(3) entrega "131.071". Postgres, que recibe la cadena "131.0715",
  // guarda 131,072. Esa diferencia de una milésima separa el snapshot del
  // historial y crece con cada movimiento.
  //
  // numeric redondea los medios ALEJÁNDOSE del cero, así que se trabaja sobre
  // el valor absoluto y el signo se repone al final. Con Math.round() los
  // medios negativos irían para el otro lado, y todo consumo y toda merma son
  // negativos.
  const sign = n < 0 ? -1 : 1;
  const text = Math.abs(n).toString();

  // Notación científica: son valores fuera del rango operativo de un almacén
  // (más de 21 dígitos o menos de una millonésima). toFixed basta.
  if (text.includes("e")) return sign * Number(Math.abs(n).toFixed(3)) || 0;

  const dot = text.indexOf(".");
  if (dot === -1 || text.length - dot - 1 <= 3) return n;

  const decimals = text.slice(dot + 1);
  const truncated = Number(text.slice(0, dot) + decimals.slice(0, 3));
  const nextDigit = Number(decimals[3]);
  const rounded = (nextDigit >= 5 ? truncated + 1 : truncated) / 1000;

  // -0 se imprimiría como "-0" en Intl.NumberFormat.
  return rounded === 0 ? 0 : sign * rounded;
}

/** Suma una lista de cantidades sin riesgo de concatenar. */
export function sumQuantities(values: Numeric[]): number {
  return round3(values.reduce<number>((acc, v) => acc + toNumber(v), 0));
}

/**
 * Formatea una cantidad para mostrarla: hasta tres decimales, sin ceros
 * sobrantes, con separadores chilenos. Si se le pasa una unidad, la agrega.
 */
export function formatQuantity(value: Numeric, unit?: string | null): string {
  const text = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 3 }).format(
    toNumber(value)
  );
  if (!unit) return text;
  return `${text} ${unit === "UN" ? "uds." : unit.toLowerCase()}`;
}

/** Igual que formatQuantity pero con signo explícito, para el historial. */
export function formatSignedQuantity(value: Numeric, unit?: string | null): string {
  const n = toNumber(value);
  return `${n > 0 ? "+" : ""}${formatQuantity(n, unit)}`;
}
