import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { subscriptionCreateSchema } from "@/lib/validation";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "viewSubscriptions")) {
    return NextResponse.json({ error: "No tienes permiso para ver suscripciones" }, { status: 403 });
  }
  const subs = await prisma.subscription.findMany({
    orderBy: { renewsAt: "asc" },
    include: { customer: { select: { name: true } } },
  });
  return NextResponse.json(subs);
}

// Una suscripción es un compromiso anual (mantención, soporte, hosting). Se
// registra cuando el cliente la contrata; la venta que la cobra es aparte y
// puede ligarse acá para saber que está pagada.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageSubscriptions")) {
    return NextResponse.json({ error: "No tienes permiso para crear suscripciones" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Cuerpo de la petición inválido" }, { status: 400 });
  }
  const parsed = subscriptionCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { customerId, name, currency, amount, startsAt, renewsAt, hoursIncluded, notes, saleId } = parsed.data;

  if (renewsAt.getTime() <= startsAt.getTime()) {
    return NextResponse.json({ error: "La renovación debe ser posterior al inicio" }, { status: 400 });
  }

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });

  if (saleId) {
    const sale = await prisma.sale.findUnique({ where: { id: saleId } });
    if (!sale || sale.customerId !== customerId) {
      return NextResponse.json({ error: "La venta no existe o es de otro cliente" }, { status: 400 });
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.create({
      data: {
        customerId,
        name,
        currency,
        amount,
        startsAt,
        renewsAt,
        hoursIncluded,
        notes: notes || null,
        saleId: saleId || null,
      },
    });
    if (customer.stage !== "CLIENTE") {
      await tx.customer.update({ where: { id: customerId }, data: { stage: "CLIENTE" } });
    }
    return sub;
  });

  return NextResponse.json(created, { status: 201 });
}
