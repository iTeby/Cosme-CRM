import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { canAccessWhatsApp } from "@/lib/whatsapp-access";

/**
 * Convierte una conversación de WhatsApp en un cliente del CRM.
 *
 * Es idempotente a propósito: busca primero por teléfono y devuelve el que ya
 * existe en vez de crear un duplicado. El botón se puede apretar dos veces sin
 * ensuciar la cartera, que es justo lo que pasa cuando uno duda si ya lo hizo.
 *
 * Esta ruta es más específica que el catch-all [[...path]] de al lado, así que
 * Next la resuelve primero y no se va al proxy del bot.
 */
export async function POST(req: NextRequest) {
  const json = (error: string, status: number) =>
    NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

  const session = await getServerSession(authOptions);
  if (!session) return json("No autorizado", 401);
  if (!(await canAccessWhatsApp())) return json("Acceso reservado al propietario", 403);
  if (!can(session.user.role, "manageCustomers")) return json("No tienes permiso para crear clientes", 403);
  if (req.headers.get("origin") !== req.nextUrl.origin) return json("Origen no permitido", 403);

  const input = await req.json().catch(() => null);
  const waId = typeof input?.wa_id === "string" ? input.wa_id.replace(/\D/g, "") : "";
  if (!/^\d{7,20}$/.test(waId)) return json("Teléfono no válido", 400);

  const telefono = `+${waId}`;
  const existente = await prisma.customer.findFirst({ where: { phone: telefono } });
  if (existente) return NextResponse.json({ id: existente.id, creado: false, nombre: existente.name });

  // El nombre del negocio es lo que escribió el cliente cuando el bot se lo
  // preguntó, así que puede venir con un párrafo entero. Se recorta al límite
  // que acepta el esquema de clientes en vez de dejar que la escritura falle.
  const limpio = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
  const nombre = limpio(input?.business_name, 120) || limpio(input?.name, 120) || telefono;

  const notas = [
    limpio(input?.summary, 900) && `Resumen del bot: ${limpio(input?.summary, 900)}`,
    limpio(input?.need, 400) && `Necesidad declarada: ${limpio(input?.need, 400)}`,
    limpio(input?.probable_service, 120) && `Servicio probable: ${limpio(input?.probable_service, 120)}`,
    `Llegó por WhatsApp el ${new Date().toLocaleDateString("es-CL")}.`,
  ].filter(Boolean).join("\n");

  const customer = await prisma.customer.create({
    data: {
      name: nombre,
      contactName: limpio(input?.name, 120),
      phone: telefono,
      stage: "CALIFICADO",
      source: "WHATSAPP",
      notes: notas.slice(0, 2000),
    },
  });

  return NextResponse.json({ id: customer.id, creado: true, nombre: customer.name }, { status: 201 });
}
