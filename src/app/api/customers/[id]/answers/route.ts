import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { qualificationAnswersSchema } from "@/lib/validation";

// Guarda las respuestas del guion de calificación de un interesado. Una
// respuesta vacía borra la anterior. Si el interesado estaba en NUEVO y ya
// respondió algo, pasa a CALIFICADO solo: es la definición de la etapa.
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageCustomers")) {
    return NextResponse.json({ error: "No tienes permiso para editar clientes" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = qualificationAnswersSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const customer = await prisma.customer.findUnique({ where: { id: params.id }, select: { id: true, stage: true } });
  if (!customer) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });

  const respondidas = parsed.data.answers.filter((a) => a.answer.length > 0);

  await prisma.$transaction(async (tx) => {
    for (const a of parsed.data.answers) {
      if (a.answer.length === 0) {
        await tx.qualificationAnswer.deleteMany({
          where: { customerId: customer.id, questionId: a.questionId },
        });
        continue;
      }
      await tx.qualificationAnswer.upsert({
        where: { customerId_questionId: { customerId: customer.id, questionId: a.questionId } },
        update: { answer: a.answer },
        create: { customerId: customer.id, questionId: a.questionId, answer: a.answer },
      });
    }
    if (customer.stage === "NUEVO" && respondidas.length > 0) {
      await tx.customer.update({ where: { id: customer.id }, data: { stage: "CALIFICADO" } });
    }
  });

  return NextResponse.json({ ok: true, respondidas: respondidas.length });
}
