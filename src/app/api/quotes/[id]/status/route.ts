import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { quoteStatusSchema } from "@/lib/validation";

// Cambios de estado manuales: enviada, rechazada, o de vuelta a borrador.
// Aceptada no se marca a mano: la marca la conversión en venta.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageQuotes")) {
    return NextResponse.json({ error: "No tienes permiso para cotizar" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = quoteStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { status } = parsed.data;

  const quote = await prisma.quote.findUnique({
    where: { id: params.id },
    include: { customer: { select: { id: true, stage: true } } },
  });
  if (!quote) return NextResponse.json({ error: "Cotización no encontrada" }, { status: 404 });
  if (quote.status === "ACEPTADA") {
    return NextResponse.json(
      { error: "Una cotización aceptada ya es una venta; no cambia de estado" },
      { status: 409 }
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const q = await tx.quote.update({
      where: { id: quote.id },
      data: {
        status,
        sentAt: status === "ENVIADA" ? quote.sentAt ?? new Date() : quote.sentAt,
      },
    });
    // Enviar la primera cotización mueve al interesado a "Cotizado"; si ya es
    // cliente o se perdió, la etapa no retrocede.
    if (status === "ENVIADA" && (quote.customer.stage === "NUEVO" || quote.customer.stage === "CALIFICADO")) {
      await tx.customer.update({ where: { id: quote.customer.id }, data: { stage: "COTIZADO" } });
    }
    return q;
  });

  return NextResponse.json(updated);
}
