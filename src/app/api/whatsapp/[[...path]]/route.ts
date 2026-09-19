import { NextRequest, NextResponse } from "next/server";
import { canAccessWhatsApp } from "@/lib/whatsapp-access";

export const dynamic = "force-dynamic";

async function proxy(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  const json = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
  if (!(await canAccessWhatsApp())) return json("Acceso reservado al propietario", 403);
  const path = (await params).path ?? [];
  // Se permite "metricas" además del teléfono: es de solo lectura y no recibe
  // cuerpo, así que la validación del POST de más abajo la sigue cubriendo.
  const permitida = path.length === 0 || (path.length === 1 && (/^\d{7,20}$/.test(path[0]) || path[0] === "metricas"));
  if (!permitida) return json("Ruta no válida", 404);
  if (path[0] === "metricas" && req.method !== "GET") return json("Ruta no válida", 405);
  const secret = process.env.WHATSAPP_INTEGRATION_SECRET;
  if (!secret) return json("La conexión con WhatsApp aún no está configurada", 503);
  let body: string | undefined;
  if (req.method === "POST") {
    const origin = req.headers.get("origin");
    const expected = req.nextUrl.origin;
    if (origin !== expected) return json("Origen no permitido", 403);
    const input = await req.json().catch(() => null);
    if (!input || !["reply", "take", "summary", "ocultar", "mostrar"].includes(input.action) || (input.action === "reply" && (typeof input.message !== "string" || !input.message.trim() || input.message.length > 900))) return json("Solicitud no válida", 400);
    body = JSON.stringify({ action: input.action, message: input.message });
  }
  try {
    // ?archivadas=1 es el único parámetro que se deja pasar: es de solo lectura y
    // es lo que permite tener una vista de archivadas con vuelta atrás.
    const consulta = req.method === "GET" && path.length === 0 && req.nextUrl.searchParams.get("archivadas") === "1" ? "?archivadas=1" : "";
    const upstream = await fetch(`https://clientes.cosmespa.cl/integrations/crm${path.length ? `/${path[0]}` : ""}${consulta}`, {
      // "manual" y no "error": el runtime de Cloudflare no implementa "error"
      // —lanza TypeError— y la intención original era no seguir jamás una
      // redirección hacia un destino distinto del bot. Con "manual" la
      // redirección llega sin seguirse y se rechaza a mano, tres líneas abajo.
      method: req.method, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(25000),
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body,
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      console.error("[whatsapp] el bot respondió con una redirección:", upstream.status, upstream.headers.get("location"));
      return json("No se pudo conectar con el panel de WhatsApp", 502);
    }
    if (!upstream.headers.get("content-type")?.includes("application/json")) return json("No se pudo conectar con el panel de WhatsApp", 502);
    return NextResponse.json(await upstream.json(), { status: upstream.status, headers: { "Cache-Control": "no-store" } });
  } catch (causa) {
    // El error se registra antes de esconderlo. Al usuario se le muestra un
    // mensaje prudente —puede que el envío sí haya salido— pero tragarse la
    // causa deja el fallo imposible de diagnosticar: se ve en `wrangler tail`.
    console.error("[whatsapp] falló la llamada al bot:", causa instanceof Error ? `${causa.name}: ${causa.message}` : causa);
    return json("No se pudo confirmar la operación. Revisa el historial antes de reintentar un envío.", 502);
  }
}

export { proxy as GET, proxy as POST };
