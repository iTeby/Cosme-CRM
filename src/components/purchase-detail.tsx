"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  purchaseStatusLabels,
  purchaseStatusTone,
  purchaseStatusTransitions,
  type PurchaseStatus,
} from "@/lib/purchases";

interface PurchaseItem {
  id: string;
  quantity: number;
  unitCost: string;
  subtotal: string;
  variant: {
    sku: string;
    attributes: string | null;
    product: { name: string };
  };
}

interface PurchaseData {
  id: string;
  number: number;
  status: PurchaseStatus;
  totalAmount: string;
  notes: string | null;
  createdAt: string;
  supplier: { id: string; name: string };
  createdBy: { name: string | null };
  items: PurchaseItem[];
}

const statusButtonLabel: Record<PurchaseStatus, string> = {
  PENDIENTE: "Volver a pendiente",
  RECIBIDA: "Marcar como recibida",
  ANULADA: "Anular compra",
};

export function PurchaseDetail({ purchase, canManage }: { purchase: PurchaseData; canManage: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const nextStatuses = purchaseStatusTransitions[purchase.status];

  async function changeStatus(status: PurchaseStatus) {
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/purchases/${purchase.id}/status`, {
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
          <Link href="/purchases" className="text-xs font-medium text-slate-400 hover:text-brand-700">
            ← Volver a compras
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-brand-900">Compra #{purchase.number}</h1>
        </div>
        <Badge tone={purchaseStatusTone[purchase.status]}>{purchaseStatusLabels[purchase.status]}</Badge>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-x-8 gap-y-2 py-4 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Proveedor</p>
            <Link
              href={`/suppliers/${purchase.supplier.id}`}
              className="font-medium text-brand-700 hover:underline"
            >
              {purchase.supplier.name}
            </Link>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Fecha</p>
            <p className="text-slate-700">{formatDate(purchase.createdAt)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Registrada por</p>
            <p className="text-slate-700">{purchase.createdBy.name || "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Notas</p>
            <p className="text-slate-700">{purchase.notes || "—"}</p>
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
                <Th>Costo unitario</Th>
                <Th>Subtotal</Th>
              </Tr>
            </Thead>
            <Tbody>
              {purchase.items.map((item) => (
                <Tr key={item.id}>
                  <Td>
                    {item.variant.product.name}{" "}
                    <span className="font-mono text-xs text-slate-400">({item.variant.sku})</span>
                  </Td>
                  <Td>{item.quantity}</Td>
                  <Td>{formatCurrency(item.unitCost)}</Td>
                  <Td>{formatCurrency(item.subtotal)}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          <div className="flex justify-end border-t border-slate-100 px-4 py-3">
            <p className="text-base font-semibold text-brand-900">
              Total: {formatCurrency(purchase.totalAmount)}
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
            {purchase.status === "PENDIENTE" && (
              <p className="mb-3 text-xs text-slate-500">
                Marcar como recibida agrega automáticamente el stock de cada línea a la bodega.
              </p>
            )}
            {purchase.status === "RECIBIDA" && (
              <p className="mb-3 text-xs text-slate-500">
                Anular esta compra revierte el stock que había agregado al recibirla.
              </p>
            )}
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
