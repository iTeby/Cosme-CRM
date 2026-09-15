import { NextResponse } from "next/server";
import { dteConfig } from "../dte";

/**
 * Los bytes de un comprobante, listos para mandarlos a la impresora.
 *
 * Se devuelven como descarga binaria y no como JSON porque el destino no es
 * el navegador: es una impresora. Con esto, cualquier máquina de la tienda
 * puede hacer `curl -s <url> > /dev/usb/lp0` sin que el sistema tenga que
 * saber cómo está conectada, que es justo lo que cambia de local en local.
 */
export function respuestaImpresion(bytes: Uint8Array, nombre: string): NextResponse {
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Texto plano, para los formatos que no son binarios como ZPL. */
export function respuestaTexto(contenido: string, nombre: string): NextResponse {
  return new NextResponse(contenido, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** El nombre que va impreso en la cabecera de los comprobantes. */
export function nombreDelNegocio(): string {
  return process.env.NEGOCIO_NOMBRE?.trim() || dteConfig().emisor.razonSocial || "Almacén";
}
