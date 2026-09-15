// Configuración de emisión electrónica.
//
// Esta es la pieza que impide emitir un folio real por accidente.
//
// Emitir una boleta de verdad con el RUT de Cosme SpA declara ante el SII una
// venta que no ocurrió. Eso no se deshace apretando otro botón: hay que
// anularla con nota de crédito y queda en el registro. Así que el sistema
// parte en certificación y llegar a producción exige dos decisiones humanas
// distintas, no una.

export type DteEnvironment = "CERTIFICACION" | "PRODUCCION";

/**
 * Las variables de entorno que importan. No se usa NodeJS.ProcessEnv porque
 * exige NODE_ENV y obliga a castear en cada prueba, y un cast de más es una
 * puerta para que un test afirme algo que el código no hace.
 */
export type Env = Record<string, string | undefined>;

/**
 * La frase que habilita producción.
 *
 * No es un booleano a propósito: un `DTE_ALLOW_PRODUCCION=true` se escribe
 * sin pensar y se copia de otro proyecto sin leerlo.
 *
 * Y lleva dentro el RUT del emisor, así que tampoco se puede copiar de un
 * ejemplo: hay que escribir el RUT de la empresa cuyos folios se van a
 * gastar. Es el único punto del sistema donde se pide teclear algo
 * entendiendo lo que significa.
 */
function frasePara(rut: string): string {
  return `si-entiendo-que-son-folios-reales-de-${rut}`;
}

export type DteConfig = {
  environment: DteEnvironment;
  provider: "openfactura" | "simulado";
  /**
   * Se deriva del ambiente, nunca se configura aparte. Si la URL fuera una
   * variable independiente, se podría quedar apuntando a producción con el
   * ambiente en certificación, y el documento saldría real con la etiqueta
   * equivocada. Acá eso es imposible por construcción.
   */
  baseUrl: string;
  apiKey: string | null;
  /**
   * Path de emisión. Configurable porque la documentación pública de
   * OpenFactura no lo expone y hay que confirmarlo contra la cuenta antes de
   * la primera emisión real. Ver el comentario en openfactura.ts.
   */
  emitPath: string;
  emisor: {
    rut: string;
    razonSocial: string;
    giro: string;
    acteco: string;
    direccion: string;
    comuna: string;
  };
};

const BASE_URLS: Record<DteEnvironment, string> = {
  // El host de pruebas de Haulmer. Las emisiones acá usan un CAF simulado:
  // el timbre no es válido y ninguna de estas boletas llega al SII como real.
  CERTIFICACION: "https://dev-api.haulmer.com",
  PRODUCCION: "https://api.haulmer.com",
};

/** Lo que impidió pasar a producción, o null si está habilitada. */
export function motivoBloqueoProduccion(env: Env = process.env): string | null {
  if (env.DTE_ENVIRONMENT !== "PRODUCCION") {
    return "DTE_ENVIRONMENT no está en PRODUCCION";
  }
  const rut = env.DTE_EMISOR_RUT?.trim();
  if (!rut) {
    return "DTE_EMISOR_RUT está vacío, y la frase de habilitación lo incluye";
  }
  if (env.DTE_ALLOW_PRODUCCION !== frasePara(rut)) {
    return `DTE_ALLOW_PRODUCCION no contiene la frase exacta para el RUT ${rut}`;
  }
  return null;
}

/**
 * Resuelve la configuración vigente.
 *
 * El valor por defecto de TODO es certificación. Una variable mal escrita, un
 * despliegue sin configurar o un `.env` incompleto caen en certificación, no
 * en producción: el modo seguro tiene que ser el que se obtiene por descuido.
 */
export function dteConfig(env: Env = process.env): DteConfig {
  const environment: DteEnvironment =
    motivoBloqueoProduccion(env) === null ? "PRODUCCION" : "CERTIFICACION";

  const apiKey = env.OPENFACTURA_API_KEY?.trim() || null;

  return {
    environment,
    // Sin credencial no se puede llamar a nadie, así que se emite contra el
    // proveedor simulado en vez de fallar. Sirve para ver la pantalla
    // completa antes de tener cuenta, que es exactamente la situación de hoy.
    provider: apiKey ? "openfactura" : "simulado",
    baseUrl: BASE_URLS[environment],
    apiKey,
    emitPath: env.OPENFACTURA_EMIT_PATH?.trim() || "/v2/dte/document",
    emisor: {
      rut: env.DTE_EMISOR_RUT?.trim() || "",
      razonSocial: env.DTE_EMISOR_RAZON_SOCIAL?.trim() || "",
      giro: env.DTE_EMISOR_GIRO?.trim() || "",
      acteco: env.DTE_EMISOR_ACTECO?.trim() || "",
      direccion: env.DTE_EMISOR_DIRECCION?.trim() || "",
      comuna: env.DTE_EMISOR_COMUNA?.trim() || "",
    },
  };
}

/** Lo que falta para poder emitir de verdad, en lenguaje de persona. */
export function faltantesDeConfiguracion(config: DteConfig): string[] {
  if (config.provider === "simulado") return [];
  const faltan: string[] = [];
  if (!config.emisor.rut) faltan.push("DTE_EMISOR_RUT");
  if (!config.emisor.razonSocial) faltan.push("DTE_EMISOR_RAZON_SOCIAL");
  if (!config.emisor.giro) faltan.push("DTE_EMISOR_GIRO");
  if (!config.emisor.acteco) faltan.push("DTE_EMISOR_ACTECO");
  if (!config.emisor.direccion) faltan.push("DTE_EMISOR_DIRECCION");
  if (!config.emisor.comuna) faltan.push("DTE_EMISOR_COMUNA");
  return faltan;
}
