import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { purchaseStatusLabels, purchaseStatusTone } from "@/lib/purchases";

export default async function PurchasesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "viewPurchases")) {
    redirect("/dashboard");
  }

  const purchases = await prisma.purchase.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      supplier: { select: { name: true } },
      items: { select: { quantity: true } },
    },
  });

  const canCreate = can(session.user.role, "managePurchases");

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-brand-900">Compras</h1>
          <p className="text-sm text-slate-500">
            Una compra recién agrega stock cuando se marca como recibida.
          </p>
        </div>
        {canCreate && (
          <Link href="/purchases/new">
            <Button>Nueva compra</Button>
          </Link>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {purchases.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">
              Todavía no hay compras registradas.
              {canCreate && " Crea la primera con el botón de arriba."}
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Compra</Th>
                  <Th>Fecha</Th>
                  <Th>Proveedor</Th>
                  <Th>Líneas</Th>
                  <Th>Total</Th>
                  <Th>Estado</Th>
                </Tr>
              </Thead>
              <Tbody>
                {purchases.map((purchase) => (
                  <Tr key={purchase.id}>
                    <Td>
                      <Link
                        href={`/purchases/${purchase.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        #{purchase.number}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-slate-500">
                      {formatDate(purchase.createdAt)}
                    </Td>
                    <Td>{purchase.supplier.name}</Td>
                    <Td>{purchase.items.length}</Td>
                    <Td>{formatCurrency(purchase.totalAmount.toString())}</Td>
                    <Td>
                      <Badge tone={purchaseStatusTone[purchase.status]}>
                        {purchaseStatusLabels[purchase.status]}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
