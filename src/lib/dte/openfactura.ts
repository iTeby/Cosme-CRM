import { codigoSii, type DteEmitInput, type DteEmitResult, type DteProvider } from "./provider";
import type { DteConfig } from "./config";
import { RUT_CONSUMIDOR_FINAL } from "./amounts";

// Adaptador de OpenFactura (Haulmer).
//
// ── LO QUE ESTÁ CONFIRMADO ──────────────────────────────────────────────
//   · Hosts: https://api.haulmer.com (producción) y
//     https://dev-api.haulmer.com (pruebas). El de pruebas usa un CAF
//     simulado: el timbre no es válido y nada llega al SII como real.
//   · La credencial va en la cabecera `apikey`.
//   · Límites: 3 peticiones por segundo, 100 por minuto. Pasarse devuelve 429.
//   · Los nombres de los campos del DTE (Encabezado, IdDoc, Emisor, Receptor,
//     Detalle, Totales y sus hijos) son los del esquema oficial del SII, que
//     es público y estable. Esa parte no es una suposición.
//
// ── LO QUE HAY QUE CONFIRMAR ANTES DE LA PRIMERA EMISIÓN ────────────────
//   · El path exacto de emisión. La documentación pública no lo expone hoy;
//     acá va `/v2/dte/document` por defecto y se puede cambiar sin tocar
//     código con OPENFACTURA_EMIT_PATH.
//   · El sobre de la petición: si el DTE va dentro de `dteJson` y junto a un
//     campo `response`, o directo en la raíz. `construirCuerpo` está aislada
//     justo para que corregir eso sea una función, no una refactorización.
//   · Los nombres exactos de los campos de la respuesta (folio, TOKEN, URL
//     del PDF). `leerRespuesta` prueba varias formas y guarda el texto crudo
//     cuando no reconoce ninguna, así que el primer intento fallido deja
//     exactamente lo que hace falta para arreglarlo.
//
// Mientras eso no esté verificado contra la cuenta, el sistema corre con el
// proveedor simulado, que no llama a nadie.

const TIMEOUT_MS = 20000;

export function proveedorOpenFactura(config: DteConfig): DteProvider {
  return {
    name: "openfactura",
    environment: config.environment,

    async emit(input: DteEmitInput): Promise<DteEmitResult> {
      if (!config.apiKey) {
        return { ok: false, error: "Falta OPENFACTURA_API_KEY" };
      }

      const cuerpo = construirCuerpo(config, input);
      const url = `${config.baseUrl}${config.emitPath}`;

      // AbortController y no confiar en el timeout del runtime: una emisión
      // colgada bloquea la caja, y peor, deja la duda de si el folio se
      // consumió. Cortar a los 20 s y dejarlo en ERROR es más honesto que
      // esperar indefinidamente.
      const controller = new AbortController();
      const corte = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: config.apiKey,
            // Si el proveedor la respeta, un reintento de la misma emisión no
            // consume un segundo folio. Si no la respeta, no estorba. Cuesta
            // una línea y cubre justo el caso peor.
            "Idempotency-Key": input.referenciaInterna,
          },
          body: JSON.stringify(cuerpo),
          signal: controller.signal,
        });

        const texto = await res.text();

        if (!res.ok) {
          // Un 4xx de validación es un "no se emitió" firme. Un 5xx, un 408 o
          // un 429 pueden haber dejado el folio consumido al otro lado.
          const firme = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
          return {
            ok: false,
            indeterminado: !firme,
            raw: texto,
            error: `El proveedor respondió ${res.status}. ${resumirError(texto)}`,
          };
        }

        return leerRespuesta(texto);
      } catch (err: unknown) {
        const abortada = err instanceof Error && err.name === "AbortError";
        // La petición pudo haber llegado. No hay forma de saberlo desde acá.
        return {
          ok: false,
          indeterminado: true,
          error: abortada
            ? "El proveedor no respondió en 20 segundos. Puede que la boleta se haya emitido igual: revisa en su portal antes de reintentar."
            : `No se pudo conectar con el proveedor: ${err instanceof Error ? err.message : "error desconocido"}. Puede que la petición haya llegado.`,
        };
      } finally {
        clearTimeout(corte);
      }
    },
  };
}

/**
 * Arma el DTE con los nombres del esquema del SII.
 *
 * Aislada a propósito: si el sobre que espera OpenFactura resulta ser otro,
 * se corrige acá y en ningún otro lado.
 */
export function construirCuerpo(config: DteConfig, input: DteEmitInput) {
  const hoy = new Date();
  const fecha = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(
    hoy.getDate()
  ).padStart(2, "0")}`;

  const dte = {
    Encabezado: {
      IdDoc: {
        TipoDTE: codigoSii[input.tipo],
        FchEmis: fecha,
        // Obligatorio en boleta. 3 = venta de bienes.
        ...(input.tipo === "FACTURA" ? {} : { IndServicio: 3 }),
      },
      Emisor: {
        RUTEmisor: config.emisor.rut,
        RznSoc: config.emisor.razonSocial,
        GiroEmis: config.emisor.giro,
        Acteco: config.emisor.acteco,
        DirOrigen: config.emisor.direccion,
        CmnaOrigen: config.emisor.comuna,
      },
      // Receptor es obligatorio en el esquema del SII incluso cuando no se
      // identifica al comprador: para eso está el RUT genérico 66666666-6.
      // Omitirlo hace rechazar el documento después de consumir el folio.
      Receptor: input.receptor
        ? { RUTRecep: input.receptor.rut, RznSocRecep: input.receptor.razonSocial }
        : { RUTRecep: RUT_CONSUMIDOR_FINAL, RznSocRecep: "Consumidor final" },
      Totales:
        input.tipo === "BOLETA_EXENTA"
          ? { MntExe: input.total, MntTotal: input.total }
          : { MntNeto: input.neto, IVA: input.iva, MntTotal: input.total },
    },
    Detalle: input.lineas.map((linea, i) => ({
      NroLinDet: i + 1,
      // El SII trunca a 80 caracteres; truncar acá evita que el documento
      // se rechace por un nombre largo después de consumir el folio.
      NmbItem: linea.nombre.slice(0, 80),
      QtyItem: linea.cantidad,
      PrcItem: linea.precioUnitario,
      MontoItem: linea.monto,
    })),
  };

  return { response: ["PDF", "FOLIO"], dteJson: dte };
}

/** Reconoce el folio y los identificadores en la respuesta del proveedor. */
export function leerRespuesta(texto: string): DteEmitResult {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(texto) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      raw: texto,
      error: "El proveedor respondió algo que no es JSON.",
    };
  }

  const folio = primerNumero(data, ["FOLIO", "folio", "Folio"]);
  const token = primerTexto(data, ["TOKEN", "token", "trackId", "TrackId"]);
  const pdf = primerTexto(data, ["PDF", "pdf", "urlPdf", "pdfUrl"]);

  if (folio === null) {
    // No se reconoció la forma. No se inventa un éxito: queda el texto crudo,
    // que es exactamente lo que hace falta para corregir este archivo.
    //
    // Y va como INDETERMINADO, no como ERROR: el proveedor respondió 200, así
    // que lo más probable es que el documento SÍ se haya emitido y que lo que
    // falle sea esta función. Este es, además, el caso que más chances tiene
    // de darse en la primerísima emisión real, justo cuando el formato de la
    // respuesta todavía no está confirmado.
    return {
      ok: false,
      indeterminado: true,
      raw: texto,
      error:
        "El proveedor aceptó la petición pero la respuesta no trae un folio reconocible. Es probable que la boleta SÍ se haya emitido: revísalo en su portal. Después ajusta leerRespuesta() en src/lib/dte/openfactura.ts con la respuesta guardada.",
    };
  }

  return {
    ok: true,
    folio,
    trackId: token ?? undefined,
    // Algunos proveedores devuelven el PDF en base64 y otros una URL. Solo se
    // guarda si parece una URL; un base64 en la base no le sirve a nadie.
    pdfUrl: pdf && /^https?:\/\//.test(pdf) ? pdf : undefined,
    externalId: token ?? undefined,
    raw: texto,
  };
}

function primerNumero(data: Record<string, unknown>, claves: string[]): number | null {
  for (const clave of claves) {
    const valor = data[clave];
    if (typeof valor === "number" && Number.isFinite(valor)) return valor;
    if (typeof valor === "string" && /^\d+$/.test(valor)) return Number(valor);
  }
  return null;
}

function primerTexto(data: Record<string, unknown>, claves: string[]): string | null {
  for (const clave of claves) {
    const valor = data[clave];
    if (typeof valor === "string" && valor.length > 0) return valor;
  }
  return null;
}

/** Saca el mensaje útil de un error del proveedor sin volcar el cuerpo entero. */
function resumirError(texto: string): string {
  try {
    const data = JSON.parse(texto) as Record<string, unknown>;
    const mensaje = primerTexto(data, ["message", "error", "detail", "Message"]);
    if (mensaje) return mensaje;
  } catch {
    // No era JSON; cae al recorte de abajo.
  }
  return texto.slice(0, 200);
}
