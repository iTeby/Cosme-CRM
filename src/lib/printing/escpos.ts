// Generador de comandos ESC/POS para impresoras térmicas de punto de venta.
//
// ESC/POS es el lenguaje que entienden casi todas las impresoras de boleta
// (Epson, Bixolon, Star en modo ESC/POS, y la mayoría de las genéricas de
// 58 y 80 mm). Este módulo arma la secuencia de bytes; no la transmite. El
// transporte depende de cómo esté conectada la impresora —USB, red, un
// agente local— y no tiene por qué contaminar la lógica.
//
// Que no imprima nada por sí solo es a propósito: así se puede probar byte
// por byte contra la especificación sin tener el fierro delante.

/** Columnas por ancho de papel, con la fuente A. */
export const COLUMNAS_80MM = 48;
export const COLUMNAS_58MM = 32;

/**
 * Caracteres de CP1252 que no coinciden con Unicode.
 *
 * De 0x20 a 0xFF, CP1252 es igual a Latin-1 y el código Unicode sirve tal
 * cual: ahí caen la ñ, las tildes y los signos de apertura. El tramo
 * 0x80-0x9F es la excepción —Windows lo usa para comillas tipográficas,
 * guiones largos y el símbolo del euro— y hay que traducirlo a mano.
 */
const CP1252_ESPECIALES: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

/**
 * Codifica texto a CP1252, que es la tabla que se selecciona con ESC t 16.
 *
 * Mandar UTF-8 a una impresora térmica es el error clásico: la "ñ" ocupa dos
 * bytes y sale como dos caracteres basura. Y peor que feo, descuadra las
 * columnas, porque el ancho se cuenta en bytes impresos y no en caracteres
 * de JavaScript. Por eso la longitud de una línea se mide sobre esta
 * codificación y no sobre el string.
 */
export function encodeCp1252(texto: string): number[] {
  const bytes: number[] = [];
  for (const caracter of texto) {
    const code = caracter.codePointAt(0) ?? 0x3f;
    if (code === 0x0a || code === 0x0d || code === 0x09) {
      bytes.push(code);
    } else if (code >= 0x20 && code <= 0xff && !(code >= 0x7f && code <= 0x9f)) {
      // Se excluye 0x7F-0x9F: en CP1252 ese tramo no coincide con Unicode y
      // los valores que sí existen ya se resolvieron en la tabla de arriba.
      // Dejar pasar el resto mandaría bytes sin definir a la impresora.
      bytes.push(code);
    } else if (CP1252_ESPECIALES[code] !== undefined) {
      bytes.push(CP1252_ESPECIALES[code]);
    } else {
      // Signo de pregunta antes que un byte inventado: un carácter que la
      // impresora no tiene se ve mal, pero un byte fuera de tabla puede
      // dejarla en un modo raro para el resto del ticket.
      bytes.push(0x3f);
    }
  }
  return bytes;
}

/** Cuánto ocupa un texto impreso, en columnas. */
export function anchoImpreso(texto: string): number {
  return encodeCp1252(texto).length;
}

export type Alineacion = "IZQUIERDA" | "CENTRO" | "DERECHA";

export class EscPos {
  private readonly buffer: number[] = [];
  readonly columnas: number;

  constructor(columnas: number = COLUMNAS_80MM) {
    this.columnas = columnas;
  }

  /**
   * ESC @ reinicia la impresora y ESC t 16 selecciona CP1252.
   *
   * Los dos van juntos y de entrada: ESC @ borra la tabla de caracteres
   * seleccionada, así que elegirla antes no sirve de nada.
   */
  init(): this {
    this.buffer.push(0x1b, 0x40);
    this.buffer.push(0x1b, 0x74, 16);
    return this;
  }

  /** ESC a n */
  align(alineacion: Alineacion): this {
    const mapa: Record<Alineacion, number> = { IZQUIERDA: 0, CENTRO: 1, DERECHA: 2 };
    this.buffer.push(0x1b, 0x61, mapa[alineacion]);
    return this;
  }

  /** ESC E n */
  bold(activo: boolean): this {
    this.buffer.push(0x1b, 0x45, activo ? 1 : 0);
    return this;
  }

  /**
   * GS ! n — tamaño del carácter. Los cuatro bits altos son el ancho y los
   * cuatro bajos el alto, cada uno de 1 a 8 veces.
   */
  size(ancho: 1 | 2 | 3 | 4 = 1, alto: 1 | 2 | 3 | 4 = 1): this {
    this.buffer.push(0x1d, 0x21, ((ancho - 1) << 4) | (alto - 1));
    return this;
  }

  text(texto: string): this {
    this.buffer.push(...encodeCp1252(texto));
    return this;
  }

  line(texto = ""): this {
    return this.text(`${texto}\n`);
  }

  feed(lineas = 1): this {
    this.buffer.push(0x1b, 0x64, Math.max(0, Math.min(255, lineas)));
    return this;
  }

  separator(caracter = "-"): this {
    return this.line(caracter.repeat(this.columnas));
  }

  /**
   * Una fila de dos columnas, con el texto a la izquierda y el monto pegado
   * al borde derecho.
   *
   * El relleno se calcula sobre el ancho IMPRESO, no sobre el largo del
   * string: "Té ñoño" son 7 caracteres de JavaScript y 7 columnas en CP1252,
   * pero serían 9 bytes en UTF-8 y la columna derecha quedaría corrida.
   */
  row(izquierda: string, derecha: string): this {
    const anchoDerecha = anchoImpreso(derecha);
    const disponible = Math.max(1, this.columnas - anchoDerecha - 1);

    let texto = izquierda;
    if (anchoImpreso(texto) > disponible) {
      // Se recorta contando columnas impresas, carácter a carácter.
      let acumulado = 0;
      let recortado = "";
      for (const caracter of izquierda) {
        const ancho = anchoImpreso(caracter);
        if (acumulado + ancho > disponible - 1) break;
        recortado += caracter;
        acumulado += ancho;
      }
      texto = `${recortado}.`;
    }

    const relleno = " ".repeat(Math.max(1, this.columnas - anchoImpreso(texto) - anchoDerecha));
    return this.line(`${texto}${relleno}${derecha}`);
  }

  /**
   * ESC p m t1 t2 — pulso para abrir el cajón de dinero.
   *
   * El cajón no se conecta al computador: cuelga de la impresora por un
   * conector RJ11, y se abre mandándole un pulso a la impresora. Pin 2 es lo
   * habitual; algunos cajones usan el 5. Los tiempos van en unidades de
   * 2 ms, así que 25 y 250 son 50 ms encendido y 500 apagado.
   */
  openCashDrawer(pin: 2 | 5 = 2): this {
    this.buffer.push(0x1b, 0x70, pin === 2 ? 0 : 1, 25, 250);
    return this;
  }

  /**
   * GS k — código de barras de una dimensión, dibujado por la impresora.
   *
   * Se usa el hardware y no una imagen porque sale nítido a cualquier
   * tamaño y ocupa una fracción de los bytes.
   */
  barcode(datos: string, tipo: "EAN13" | "CODE128" = "CODE128", alto = 60): this {
    // El largo va en un byte: más de 255 se truncaría módulo 256 y el código
    // saldría basura en vez de fallar.
    if (datos.length > 250) throw new Error("BARCODE_TOO_LONG");
    // GS h n — alto en puntos. GS w n — ancho del módulo. GS H 2 — el número
    // impreso debajo de las barras, que es lo que alguien teclea si el
    // lector no lo agarra.
    this.buffer.push(0x1d, 0x68, Math.max(1, Math.min(255, alto)));
    this.buffer.push(0x1d, 0x77, 2);
    this.buffer.push(0x1d, 0x48, 2);

    if (tipo === "EAN13") {
      const datosBytes = encodeCp1252(datos);
      this.buffer.push(0x1d, 0x6b, 67, datosBytes.length, ...datosBytes);
      return this;
    }

    // En Code 128 el juego de caracteres se elige dentro de los datos con
    // "{B". Y como "{" es el carácter de escape, un "{" literal del texto
    // hay que duplicarlo o el código sale con otro contenido.
    const escapado = datos.replace(/\{/g, "{{");
    const datosBytes = [0x7b, 0x42, ...encodeCp1252(escapado)];
    this.buffer.push(0x1d, 0x6b, 73, datosBytes.length, ...datosBytes);
    return this;
  }

  /**
   * GS ( k — código PDF417.
   *
   * Es el formato del timbre electrónico del SII. Acá está disponible para
   * cuando el proveedor devuelva el TED; el sistema no lo genera por su
   * cuenta, porque firmarlo exige certificado digital y archivos CAF.
   */
  pdf417(datos: string, columnas = 8, nivelCorreccion = 3): this {
    const datosBytes = encodeCp1252(datos);

    // Número de columnas (fn 65).
    this.buffer.push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x30, 0x41, Math.max(1, Math.min(30, columnas)));

    // Nivel de corrección de error (fn 69). Con m = 0x31 el nivel va como
    // carácter ASCII, de "0" a "8": mandar el entero crudo deja el valor
    // fuera de rango y la impresora ignora el comando en silencio.
    const nivel = 48 + Math.max(0, Math.min(8, nivelCorreccion));
    this.buffer.push(0x1d, 0x28, 0x6b, 0x04, 0x00, 0x30, 0x45, 0x31, nivel);

    // Datos (fn 80). pL y pH son el largo en little endian, contando los
    // tres bytes de cn, fn y m.
    const largo = datosBytes.length + 3;
    this.buffer.push(0x1d, 0x28, 0x6b, largo % 256, Math.floor(largo / 256), 0x30, 0x50, 0x30, ...datosBytes);

    // Imprimir el símbolo (fn 81).
    this.buffer.push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x30, 0x51, 0x30);
    return this;
  }

  /** ESC d n para avanzar el papel y GS V m para cortarlo. */
  cut(parcial = true): this {
    this.buffer.push(0x1b, 0x64, 4);
    this.buffer.push(0x1d, 0x56, parcial ? 1 : 0);
    return this;
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}
