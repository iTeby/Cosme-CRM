import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";

/**
 * Entrega el guion de calificación para llenarlo desde cualquier pantalla.
 *
 * Con `wa_id` busca además si ese teléfono ya tiene ficha —la misma búsqueda
 * por teléfono que hace /api/whatsapp/customer, para que las dos pantallas
 * coincidan en qué cuenta como el mismo cliente— y devuelve lo ya respondido.
 * Sin ficha devuelve `customer: null` y el guion en blanco: recién cuando se
 * guarda hace falta crearla.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (!can(session.user.role, "manageCustomers")) {
    return NextResponse.json({ error: "No tienes permiso para ver clientes" }, { status: 403 });
  }

  const questions = await prisma.qualificationQuestion.findMany({
    where: { active: true },
    orderBy: { position: "asc" },
    select: { id: true, position: true, block: true, text: true, reason: true },
  });

  const waId = (req.nextUrl.searchParams.get("wa_id") ?? "").replace(/\D/g, "");
  if (!/^\d{7,20}$/.test(waId)) {
    return NextResponse.json(
      { questions, customer: null, answers: [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const customer = await prisma.customer.findFirst({
    where: { phone: `+${waId}` },
    select: {
      id: true,
      name: true,
      answers: { select: { questionId: true, answer: true } },
    },
  });

  return NextResponse.json(
    {
      questions,
      customer: customer ? { id: customer.id, name: customer.name } : null,
      answers: customer?.answers ?? [],
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
