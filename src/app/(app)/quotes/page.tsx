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
import { formatDate } from "@/lib/utils";
import { formatQuoteAmount, isExpired, quoteStatusLabels, quoteStatusTone } from "@/lib/quotes";

export default async function QuotesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "viewQuotes")) {
    redirect("/dashboard");
  }

  const quotes = await prisma.quote.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { name: true } },
      items: { select: { id: true } },
    },
  });

  const canCreate = can(session.user.role, "manageQuotes");

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-brand-900">Cotizaciones</h1>
          <p className="text-sm text-slate-500">
            Una cotización no mueve stock ni caja. Al aceptarse se convierte en venta.
          </p>
        </div>
        {canCreate && (
          <Link href="/quotes/new">
            <Button>Nueva cotización</Button>
          </Link>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {quotes.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">
              Todavía no hay cotizaciones.
              {canCreate && " Crea la primera con el botón de arriba."}
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>N°</Th>
                  <Th>Fecha</Th>
                  <Th>Cliente</Th>
                  <Th>Líneas</Th>
                  <Th>Total</Th>
                  <Th>Válida hasta</Th>
                  <Th>Estado</Th>
                </Tr>
              </Thead>
              <Tbody>
                {quotes.map((q) => {
                  const vencida = isExpired(q.status, q.validUntil);
                  return (
                    <Tr key={q.id}>
                      <Td>
                        <Link href={`/quotes/${q.id}`} className="font-medium text-brand-700 hover:underline">
                          #{q.number}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-slate-500">{formatDate(q.createdAt)}</Td>
                      <Td>{q.customer.name}</Td>
                      <Td>{q.items.length}</Td>
                      <Td>{formatQuoteAmount(q.totalAmount, q.currency)}</Td>
                      <Td className={vencida ? "whitespace-nowrap text-xs text-red-700" : "whitespace-nowrap text-xs text-slate-500"}>
                        {formatDate(q.validUntil)}
                      </Td>
                      <Td>
                        <Badge tone={vencida ? "critical" : quoteStatusTone[q.status]}>
                          {vencida ? "Vencida" : quoteStatusLabels[q.status]}
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
