import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { currentShift } from "@/lib/cash";
import { CustomerDetail } from "@/components/customer-detail";
import { availableDiagnosticCredit } from "@/lib/diagnostic-credit";

export default async function CustomerDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "manageCustomers")) {
    redirect("/dashboard");
  }

  // La libreta de fiados —cuánto debe, quién le cobró, con qué medio— es caja,
  // no ficha de cliente. Quien no tiene viewPayments no la recibe: no basta con
  // esconderla en el cliente, porque el payload viaja igual al navegador.
  const canViewPayments = can(session.user.role, "viewPayments");

  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    include: {
      sales: {
        orderBy: { createdAt: "desc" },
        include: { items: true },
      },
      quotes: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          number: true,
          status: true,
          currency: true,
          totalAmount: true,
          validUntil: true,
          createdAt: true,
        },
      },
      subscriptions: {
        orderBy: { renewsAt: "asc" },
        select: {
          id: true,
          name: true,
          status: true,
          currency: true,
          amount: true,
          renewsAt: true,
        },
      },
      answers: { select: { questionId: true, answer: true } },
      ...(canViewPayments
        ? {
            payments: {
              orderBy: { createdAt: "desc" },
              take: 30,
              include: {
                sale: { select: { number: true } },
                createdBy: { select: { name: true } },
              },
            },
          }
        : {}),
    },
  });

  if (!customer) notFound();

  const data = JSON.parse(JSON.stringify(customer));

  // El guion de calificación es el mismo para todos; las respuestas son del cliente.
  const questions = await prisma.qualificationQuestion.findMany({
    where: { active: true },
    orderBy: { position: "asc" },
    select: { id: true, position: true, block: true, text: true, reason: true },
  });
  const credit = canViewPayments
    ? await availableDiagnosticCredit(prisma, customer.id)
    : { amount: 0, saleId: null };

  // Abono a cuenta: no hay una venta que determine la bodega, así que la caja
  // es la de la bodega por defecto, igual que en POST /api/payments.
  const bodega = canViewPayments
    ? await prisma.warehouse.findFirst({ where: { isDefault: true } })
    : null;
  const turnoAbierto = bodega ? await currentShift(prisma, bodega.id) : null;

  return (
    <CustomerDetail
      customer={{ ...data, payments: data.payments ?? [] }}
      canManage
      canViewPayments={canViewPayments}
      canManagePayments={can(session.user.role, "managePayments")}
      cashShiftOpen={turnoAbierto !== null}
      questions={questions}
      answers={data.answers ?? []}
      diagnosticCredit={credit.amount}
    />
  );
}
