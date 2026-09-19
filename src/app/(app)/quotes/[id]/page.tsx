import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { availableDiagnosticCredit } from "@/lib/diagnostic-credit";
import { QuoteDetail } from "@/components/quote-detail";

export default async function QuoteDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "viewQuotes")) {
    redirect("/dashboard");
  }

  const quote = await prisma.quote.findUnique({
    where: { id: params.id },
    include: {
      customer: { select: { id: true, name: true, contactName: true, email: true, phone: true } },
      createdBy: { select: { name: true } },
      items: { include: { variant: { select: { sku: true, product: { select: { name: true } } } } } },
      sale: { select: { id: true, number: true } },
    },
  });
  if (!quote) notFound();

  const canManage = can(session.user.role, "manageQuotes") && can(session.user.role, "manageSales");
  const credit = canManage ? await availableDiagnosticCredit(prisma, quote.customerId) : { amount: 0, saleId: null };

  return (
    <QuoteDetail
      quote={JSON.parse(JSON.stringify(quote))}
      canManage={canManage}
      diagnosticCredit={credit.amount}
    />
  );
}
