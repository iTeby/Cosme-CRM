import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProductsList } from "@/components/products-list";

export default async function ProductsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "viewCatalog")) {
    redirect("/dashboard");
  }

  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    include: { variants: { include: { stockLevels: true } } },
  });

  const canManage = can(session.user.role, "manageProducts");

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-brand-900">Productos</h1>
          <p className="text-sm text-slate-500">
            Catálogo de productos y variantes/SKU con su stock actual.
          </p>
        </div>
        {canManage && (
          <div className="flex gap-3">
            <Link href="/products/import">
              <Button variant="secondary">Importar Excel</Button>
            </Link>
            <Link href="/products/new">
              <Button>Nuevo producto</Button>
            </Link>
          </div>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {/* Mapeo explícito y no JSON.parse(JSON.stringify()): los Decimal
              se convierten a texto acá, con TypeScript verificando el límite,
              y de paso solo viaja al navegador lo que la tabla usa. */}
          <ProductsList
            products={products.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              category: p.category,
              active: p.active,
              variants: p.variants.map((v) => ({
                id: v.id,
                sku: v.sku,
                active: v.active,
                lowStockThreshold: v.lowStockThreshold.toString(),
                stockLevels: v.stockLevels.map((l) => ({ quantity: l.quantity.toString() })),
              })),
            }))}
            canManage={canManage}
          />
        </CardContent>
      </Card>
    </div>
  );
}
