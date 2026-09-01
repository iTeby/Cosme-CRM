import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { SaleForm } from "@/components/sale-form";

export default async function NewSalePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "manageSales")) {
    redirect("/sales");
  }

  const [customers, variants] = await Promise.all([
    prisma.customer.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.productVariant.findMany({
      where: { active: true },
      include: { product: true, stockLevels: true },
      orderBy: { sku: "asc" },
    }),
  ]);

  if (customers.length === 0) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold text-brand-900">Nueva venta</h1>
        <p className="mt-2 text-sm text-slate-500">
          Todavía no hay clientes activos. Crea uno primero en la sección de{" "}
          <Link href="/customers" className="font-medium text-brand-700 hover:underline">
            Clientes
          </Link>
          .
        </p>
      </div>
    );
  }

  if (variants.length === 0) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold text-brand-900">Nueva venta</h1>
        <p className="mt-2 text-sm text-slate-500">
          Todavía no hay productos activos. Crea uno primero en la sección de{" "}
          <Link href="/products" className="font-medium text-brand-700 hover:underline">
            Productos
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <SaleForm
      customers={JSON.parse(JSON.stringify(customers))}
      variants={JSON.parse(JSON.stringify(variants))}
    />
  );
}
