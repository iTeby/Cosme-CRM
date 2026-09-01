import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatNumber } from "@/lib/utils";

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
          <Link href="/products/new">
            <Button>Nuevo producto</Button>
          </Link>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {products.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">
              Todavía no hay productos cargados.
              {canManage && " Crea el primero con el botón de arriba."}
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Producto</Th>
                  <Th>Categoría</Th>
                  <Th>Variantes</Th>
                  <Th>Stock total</Th>
                  <Th>Estado</Th>
                </Tr>
              </Thead>
              <Tbody>
                {products.map((product) => {
                  const totalStock = product.variants.reduce(
                    (sum, v) => sum + v.stockLevels.reduce((s, l) => s + l.quantity, 0),
                    0
                  );
                  const hasLowStock = product.variants.some((v) => {
                    const qty = v.stockLevels.reduce((s, l) => s + l.quantity, 0);
                    return qty <= v.lowStockThreshold;
                  });

                  return (
                    <Tr key={product.id}>
                      <Td>
                        <Link
                          href={`/products/${product.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {product.name}
                        </Link>
                        <p className="text-xs text-slate-400">
                          {product.variants.length}{" "}
                          {product.variants.length === 1 ? "SKU" : "SKUs"}:{" "}
                          {product.variants.map((v) => v.sku).join(", ")}
                        </p>
                      </Td>
                      <Td>{product.category || "—"}</Td>
                      <Td>{product.variants.length}</Td>
                      <Td>
                        <span className={hasLowStock ? "font-medium text-amber-700" : ""}>
                          {formatNumber(totalStock)}
                        </span>
                        {hasLowStock && (
                          <Badge tone="warn" className="ml-2">
                            Stock bajo
                          </Badge>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={product.active ? "good" : "neutral"}>
                          {product.active ? "Activo" : "Inactivo"}
                        </Badge>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
