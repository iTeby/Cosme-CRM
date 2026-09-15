import { dteConfig, faltantesDeConfiguracion, motivoBloqueoProduccion } from "./config";
import { proveedorOpenFactura } from "./openfactura";
import { proveedorSimulado, type DteProvider } from "./provider";

/**
 * El proveedor vigente según la configuración.
 *
 * Sin credencial devuelve el simulado, que no llama a nadie. Es el estado de
 * hoy y no es un error: permite ver la pantalla completa sin inventar que se
 * emitió algo.
 */
export function proveedorVigente(): DteProvider {
  const config = dteConfig();
  return config.provider === "openfactura"
    ? proveedorOpenFactura(config)
    : proveedorSimulado(config);
}

export { dteConfig, faltantesDeConfiguracion, motivoBloqueoProduccion };
export * from "./amounts";
export * from "./issue";
export * from "./provider";
export type { DteConfig, DteEnvironment } from "./config";
