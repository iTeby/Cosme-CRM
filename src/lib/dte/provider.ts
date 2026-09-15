import type { DteConfig, DteEnvironment } from "./config";

// El contrato que cumple cualquier proveedor de emisión.
//
// Existe para que cambiar de OpenFactura a otro no obligue a tocar nada más
// que un archivo. La forma de la petición es de cada proveedor; la forma del
// resultado es del sistema.

export type DteTipo = "BOLETA" | "BOLETA_EXENTA" | "FACTURA";

/** Códigos del SII. El proveedor habla en estos números, no en nombres. */
export const codigoSii: Record<DteTipo, number> = {
  BOLETA: 39,
  BOLETA_EXENTA: 41,
  FACTURA: 33,
};

export type DteLinea = {
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  /** Precio por cantidad, ya redondeado a peso entero. */
  monto: number;
};

export type DteEmitInput = {
  tipo: DteTipo;
  /** El id del Dte local. Se manda como referencia para poder conciliar. */
  referenciaInterna: string;
  receptor: {
    /** Vacío = consumidor final. */
    rut: string;
    razonSocial: string;
  } | null;
  lineas: DteLinea[];
  neto: number;
  iva: number;
  total: number;
};

export type DteEmitResult = {
  ok: boolean;
  /**
   * true cuando NO se puede afirmar que el folio quedó sin consumir: la
   * llamada se cortó por tiempo, se cayó la red después de enviar, o el
   * proveedor respondió algo que no se pudo interpretar.
   *
   * "Falló" y "no sé" no son lo mismo, y tratarlos igual es lo que emite dos
   * boletas: un fallo se reintenta al instante, una duda hay que ir a
   * resolverla al portal del proveedor antes de tocar nada.
   */
  indeterminado?: boolean;
  folio?: number;
  externalId?: string;
  trackId?: string;
  pdfUrl?: string;
  /** Texto crudo de la respuesta, para diagnosticar sin adivinar. */
  raw?: string;
  error?: string;
};

export interface DteProvider {
  readonly name: string;
  readonly environment: DteEnvironment;
  emit(input: DteEmitInput): Promise<DteEmitResult>;
}

/**
 * Proveedor simulado.
 *
 * No es un stub de pruebas: es el modo en que corre el sistema mientras no
 * hay credenciales, que es la situación real hoy. Permite ver la pantalla
 * completa —estado, folio, PDF ausente— sin inventar que se emitió algo. El
 * folio que asigna es local y se marca como tal; jamás sale de esta máquina.
 */
export function proveedorSimulado(config: DteConfig): DteProvider {
  return {
    name: "simulado",
    environment: config.environment,
    async emit(input: DteEmitInput): Promise<DteEmitResult> {
      return {
        ok: true,
        // Folio local, deliberadamente en un rango alto para que sea obvio
        // que no viene del SII si alguien lo ve en la base.
        folio: 900000 + Math.floor(Math.random() * 99999),
        externalId: `simulado-${input.referenciaInterna}`,
        raw: JSON.stringify({
          simulado: true,
          aviso:
            "Documento no emitido. No hay credenciales configuradas, así que no se llamó a ningún proveedor ni al SII.",
          input,
        }),
      };
    },
  };
}
