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
import { saleStatusLabels, saleStatusTone } from "@/lib/sales";

export default async function SalesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "viewSales")) {
    redirect("/dashboard");
  }

  const sales = await prisma.sale.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { name: true } },
      items: { select: { quantity: true } },
    },
  });

  const canCreate = can(session.user.role, "manageSales");

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-brand-900">Ventas</h1>
          <p className="text-sm text-slate-500">
            Cada venta descuenta stock automáticamente al registrarse.
          </p>
        </div>
        {canCreate && (
          <Link href="/sales/new">
            <Button>Nueva venta</Button>
          </Link>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {sales.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">
              Todavía no hay ventas registradas.
              {canCreate && " Crea la primera con el botón de arriba."}
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Venta</Th>
                  <Th>Fecha</Th>
                  <Th>Cliente</Th>
                  <Th>Líneas</Th>
                  <Th>Total</Th>
                  <Th>Estado</Th>
                </Tr>
              </Thead>
              <Tbody>
                {sales.map((sale) => (
                  <Tr key={sale.id}>
                    <Td>
                      <Link
                        href={`/sales/${sale.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        #{sale.number}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-slate-500">
                      {formatDate(sale.createdAt)}
                    </Td>
                    <Td>{sale.customer.name}</Td>
                    <Td>{sale.items.length}</Td>
                    <Td>{formatCurrency(sale.totalAmount.toString())}</Td>
                    <Td>
                      <Badge tone={saleStatusTone[sale.status]}>
                        {saleStatusLabels[sale.status]}
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
