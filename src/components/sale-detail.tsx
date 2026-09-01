"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { saleStatusLabels, saleStatusTone, saleStatusTransitions, type SaleStatus } from "@/lib/sales";

interface SaleItem {
  id: string;
  quantity: number;
  unitPrice: string;
  subtotal: string;
  variant: {
    sku: string;
    attributes: string | null;
    product: { name: string };
  };
}

interface SaleData {
  id: string;
  number: number;
  status: SaleStatus;
  totalAmount: string;
  notes: string | null;
  createdAt: string;
  customer: { id: string; name: string };
  createdBy: { name: string | null };
  items: SaleItem[];
}

const statusButtonLabel: Record<SaleStatus, string> = {
  PENDIENTE: "Volver a pendiente",
  PAGADA: "Marcar como pagada",
  ENTREGADA: "Marcar como entregada",
  ANULADA: "Anular venta",
};

export function SaleDetail({ sale, canManage }: { sale: SaleData; canManage: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const nextStatuses = saleStatusTransitions[sale.status];

  async function changeStatus(status: SaleStatus) {
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/sales/${sale.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo cambiar el estado.");
      return;
    }

    router.refresh();
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/sales" className="text-xs font-medium text-slate-400 hover:text-brand-700">
            ← Volver a ventas
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-brand-900">Venta #{sale.number}</h1>
        </div>
        <Badge tone={saleStatusTone[sale.status]}>{saleStatusLabels[sale.status]}</Badge>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-x-8 gap-y-2 py-4 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Cliente</p>
            <Link
              href={`/customers/${sale.customer.id}`}
              className="font-medium text-brand-700 hover:underline"
            >
              {sale.customer.name}
            </Link>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Fecha</p>
            <p className="text-slate-700">{formatDate(sale.createdAt)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Registrada por</p>
            <p className="text-slate-700">{sale.createdBy.name || "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Notas</p>
            <p className="text-slate-700">{sale.notes || "—"}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Productos</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <Thead>
              <Tr>
                <Th>Producto</Th>
                <Th>Cantidad</Th>
                <Th>Precio unitario</Th>
                <Th>Subtotal</Th>
              </Tr>
            </Thead>
            <Tbody>
              {sale.items.map((item) => (
                <Tr key={item.id}>
                  <Td>
                    {item.variant.product.name}{" "}
                    <span className="font-mono text-xs text-slate-400">({item.variant.sku})</span>
                  </Td>
                  <Td>{item.quantity}</Td>
                  <Td>{formatCurrency(item.unitPrice)}</Td>
                  <Td>{formatCurrency(item.subtotal)}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          <div className="flex justify-end border-t border-slate-100 px-4 py-3">
            <p className="text-base font-semibold text-brand-900">
              Total: {formatCurrency(sale.totalAmount)}
            </p>
          </div>
        </CardContent>
      </Card>

      {canManage && nextStatuses.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Cambiar estado</CardTitle>
          </CardHeader>
          <CardContent>
            {sale.status === "PENDIENTE" || sale.status === "PAGADA" ? (
              <p className="mb-3 text-xs text-slate-500">
                Anular esta venta repone automáticamente el stock que había descontado.
              </p>
            ) : null}
            {error && (
              <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}
            <div className="flex gap-3">
              {nextStatuses.map((status) => (
                <Button
                  key={status}
                  variant={status === "ANULADA" ? "danger" : "primary"}
                  disabled={loading}
                  onClick={() => changeStatus(status)}
                >
                  {statusButtonLabel[status]}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
