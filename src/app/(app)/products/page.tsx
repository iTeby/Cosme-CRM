import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProductsList } from "@/components/products-list";

export default async function ProductsPage() {
  const session = await getServerSession(authOptions);
  if (!session) return null;

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
          <ProductsList products={products} canManage={canManage} />
        </CardContent>
      </Card>
    </div>
  );
}
