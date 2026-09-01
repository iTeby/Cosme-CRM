import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { PurchaseForm } from "@/components/purchase-form";

export default async function NewPurchasePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "managePurchases")) {
    redirect("/purchases");
  }

  const [suppliers, variants] = await Promise.all([
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.productVariant.findMany({
      where: { active: true },
      include: { product: true },
      orderBy: { sku: "asc" },
    }),
  ]);

  if (suppliers.length === 0) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold text-brand-900">Nueva compra</h1>
        <p className="mt-2 text-sm text-slate-500">
          Todavía no hay proveedores activos. Crea uno primero en la sección de{" "}
          <Link href="/suppliers" className="font-medium text-brand-700 hover:underline">
            Proveedores
          </Link>
          .
        </p>
      </div>
    );
  }

  if (variants.length === 0) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold text-brand-900">Nueva compra</h1>
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
    <PurchaseForm
      suppliers={JSON.parse(JSON.stringify(suppliers))}
      variants={JSON.parse(JSON.stringify(variants))}
    />
  );
}
