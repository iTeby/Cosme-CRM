import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { lotStatusSchema, primerMensaje } from "@/lib/validation";

// Bloquear o liberar un lote.
//
// Cambiar el estado NO mueve stock: lo bloqueado sigue estando en la bodega
// y sigue contando en el inventario, solo deja de ofrecerse para la venta.
// Botarlo es una merma, y esa se registra aparte y con su motivo.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageStock")) {
    return NextResponse.json({ error: "No tienes permiso para mover inventario" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Cuerpo de la petición inválido" }, { status: 400 });
  }
  const parsed = lotStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: primerMensaje(parsed.error) }, { status: 400 });
  }

  try {
    const lote = await prisma.lot.update({
      where: { id: params.id },
      data: {
        status: parsed.data.status,
        // Solo se toca la nota si viene: el cliente manda únicamente el
        // estado al bloquear, y sobrescribirla borraba justo la razón por la
        // que se recibió con observaciones.
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
      },
    });
    return NextResponse.json(lote);
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo actualizar el lote" }, { status: 500 });
  }
}
