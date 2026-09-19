import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { round2, toNumber } from "@/lib/decimal";
import { subscriptionHoursSchema } from "@/lib/validation";

// Registrar horas usadas de una suscripción. El contador de la suscripción y
// la bitácora se escriben juntos, así nunca discrepan.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageSubscriptions")) {
    return NextResponse.json({ error: "No tienes permiso para registrar horas" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = subscriptionHoursSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { hours, description } = parsed.data;

  try {
    const log = await prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({ where: { id: params.id } });
      if (!sub) throw new Error("NOT_FOUND");
      if (sub.status !== "ACTIVA") throw new Error("CANCELLED");

      const created = await tx.subscriptionHourLog.create({
        data: { subscriptionId: sub.id, hours, description, createdById: session.user.id },
      });
      await tx.subscription.update({
        where: { id: sub.id },
        data: { hoursUsed: round2(toNumber(sub.hoursUsed) + hours) },
      });
      return created;
    });
    return NextResponse.json(log, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message === "NOT_FOUND") {
      return NextResponse.json({ error: "Suscripción no encontrada" }, { status: 404 });
    }
    if (message === "CANCELLED") {
      return NextResponse.json({ error: "La suscripción está cancelada" }, { status: 409 });
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudieron registrar las horas" }, { status: 500 });
  }
}
