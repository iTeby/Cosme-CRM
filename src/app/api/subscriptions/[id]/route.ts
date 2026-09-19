import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { subscriptionUpdateSchema } from "@/lib/validation";

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageSubscriptions")) {
    return NextResponse.json({ error: "No tienes permiso para editar suscripciones" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = subscriptionUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, amount, renewsAt, hoursIncluded, notes, status } = parsed.data;

  const existing = await prisma.subscription.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "Suscripción no encontrada" }, { status: 404 });

  const updated = await prisma.subscription.update({
    where: { id: params.id },
    data: { name, amount, renewsAt, hoursIncluded, notes: notes || null, status },
  });
  return NextResponse.json(updated);
}
