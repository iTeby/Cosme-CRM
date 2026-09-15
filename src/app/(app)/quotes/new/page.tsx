import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { QuoteForm } from "@/components/quote-form";

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: { customerId?: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "manageQuotes")) {
    redirect("/quotes");
  }

  const [customers, variants] = await Promise.all([
    prisma.customer.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.productVariant.findMany({
      where: { active: true },
      include: { product: { select: { name: true, pricingType: true } } },
      orderBy: { sku: "asc" },
    }),
  ]);

  if (customers.length === 0) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold text-brand-900">Nueva cotización</h1>
        <p className="mt-2 text-sm text-slate-500">
          Todavía no hay interesados activos. Crea uno primero en{" "}
          <Link href="/customers" className="font-medium text-brand-700 hover:underline">
            Clientes
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <QuoteForm
      customers={customers}
      variants={JSON.parse(JSON.stringify(variants))}
      defaultCustomerId={searchParams.customerId}
    />
  );
}
