"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { formatQuantity } from "@/lib/decimal";
import {
  formatQuoteAmount,
  isExpired,
  quoteStatusLabels,
  quoteStatusTone,
  type Currency,
  type QuoteStatus,
} from "@/lib/quotes";

interface ItemRow {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  subtotal: string;
  variant: { sku: string; product: { name: string } };
}

interface QuoteData {
  id: string;
  number: number;
  status: QuoteStatus;
  currency: Currency;
  ufValue: string | null;
  validUntil: string;
  notes: string | null;
  totalAmount: string;
  sentAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
  customer: { id: string; name: string; contactName: string | null; email: string | null; phone: string | null };
  createdBy: { name: string | null };
  items: ItemRow[];
  sale: { id: string; number: number } | null;
}

export function QuoteDetail({
  quote,
  canManage,
  diagnosticCredit,
}: {
  quote: QuoteData;
  canManage: boolean;
  diagnosticCredit: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [converting, setConverting] = useState(false);
  const [purchaseOrder, setPurchaseOrder] = useState("");
  const [ufValue, setUfValue] = useState("");
  const [applyCredit, setApplyCredit] = useState(diagnosticCredit > 0);

  const vencida = isExpired(quote.status, quote.validUntil);
  const abierta = quote.status === "BORRADOR" || quote.status === "ENVIADA";

  async function cambiarEstado(status: "ENVIADA" | "RECHAZADA" | "BORRADOR") {
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/quotes/${quote.id}/status`, {
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

  async function convertir() {
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/quotes/${quote.id}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        purchaseOrder,
        ufValue: quote.currency === "UF" ? Number(ufValue) || undefined : undefined,
        applyCredit,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo convertir la cotización.");
      return;
    }
    const sale = await res.json();
    router.push(`/sales/${sale.id}`);
    router.refresh();
  }

  const factor = quote.currency === "UF" ? Number(ufValue) || 0 : 1;
  const totalClp = Number(quote.totalAmount) * factor;
  const descuento = applyCredit ? Math.min(diagnosticCredit, totalClp) : 0;

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/quotes" className="text-xs font-medium text-slate-400 hover:text-brand-700">
            ← Volver a cotizaciones
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-brand-900">Cotización #{quote.number}</h1>
          <p className="text-sm text-slate-500">
            {formatDate(quote.createdAt)} · {quote.createdBy.name || "—"}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-slate-400">Total neto</p>
            <p className="text-lg font-semibold text-brand-900">
              {formatQuoteAmount(quote.totalAmount, quote.currency)}
            </p>
          </div>
          <Badge tone={vencida ? "critical" : quoteStatusTone[quote.status]}>
            {vencida ? "Vencida" : quoteStatusLabels[quote.status]}
          </Badge>
        </div>
      </div>

      <Card>
        <CardContent className="py-4">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">Cliente</dt>
            <dd>
              <Link href={`/customers/${quote.customer.id}`} className="font-medium text-brand-700 hover:underline">
                {quote.customer.name}
              </Link>
              {quote.customer.contactName && (
                <span className="block text-xs text-slate-500">{quote.customer.contactName}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">Válida hasta</dt>
            <dd className={vencida ? "text-red-700" : "text-slate-700"}>{formatDate(quote.validUntil)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">Enviada</dt>
            <dd className="text-slate-700">{quote.sentAt ? formatDate(quote.sentAt) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">Venta</dt>
            <dd className="text-slate-700">
              {quote.sale ? (
                <Link href={`/sales/${quote.sale.id}`} className="font-medium text-brand-700 hover:underline">
                  #{quote.sale.number}
                </Link>
              ) : (
                "—"
              )}
              {quote.ufValue && <span className="block text-xs text-slate-500">UF a {formatCurrency(quote.ufValue)}</span>}
            </dd>
          </div>
          {quote.notes && (
            <div className="col-span-2 md:col-span-4">
              <dt className="text-xs uppercase tracking-wide text-slate-400">Notas</dt>
              <dd className="whitespace-pre-line text-slate-700">{quote.notes}</dd>
            </div>
          )}
          </dl>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Líneas</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <Thead>
              <Tr>
                <Th>Ítem</Th>
                <Th>Descripción</Th>
                <Th>Cantidad</Th>
                <Th>Precio</Th>
                <Th>Subtotal</Th>
              </Tr>
            </Thead>
            <Tbody>
              {quote.items.map((item) => (
                <Tr key={item.id}>
                  <Td className="whitespace-nowrap text-xs text-slate-500">{item.variant.sku}</Td>
                  <Td className="whitespace-pre-line">{item.description}</Td>
                  <Td>{formatQuantity(item.quantity)}</Td>
                  <Td>{formatQuoteAmount(item.unitPrice, quote.currency)}</Td>
                  <Td className="font-medium">{formatQuoteAmount(item.subtotal, quote.currency)}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </CardContent>
      </Card>

      {canManage && abierta && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Acciones</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="flex flex-wrap gap-3">
              {quote.status === "BORRADOR" && (
                <Button onClick={() => cambiarEstado("ENVIADA")} disabled={loading}>
                  Marcar enviada
                </Button>
              )}
              {quote.status === "ENVIADA" && (
                <Button variant="secondary" onClick={() => cambiarEstado("BORRADOR")} disabled={loading}>
                  Volver a borrador
                </Button>
              )}
              <Button variant="secondary" onClick={() => setConverting((v) => !v)} disabled={loading}>
                {converting ? "Cancelar conversión" : "Convertir en venta"}
              </Button>
              <Button variant="danger" onClick={() => cambiarEstado("RECHAZADA")} disabled={loading}>
                Rechazada
              </Button>
            </div>

            {converting && (
              <div className="space-y-4 rounded-lg border border-slate-200 p-4">
                <p className="text-sm text-slate-500">
                  Se crea la venta en pesos con estas líneas. Los servicios no tocan stock.
                </p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="cv-po">Orden de compra del cliente</Label>
                    <Input
                      id="cv-po"
                      value={purchaseOrder}
                      onChange={(e) => setPurchaseOrder(e.target.value)}
                      placeholder="Opcional"
                    />
                  </div>
                  {quote.currency === "UF" && (
                    <div>
                      <Label htmlFor="cv-uf">Valor de la UF hoy (CLP)</Label>
                      <Input
                        id="cv-uf"
                        type="number"
                        min="1"
                        step="0.01"
                        value={ufValue}
                        onChange={(e) => setUfValue(e.target.value)}
                      />
                    </div>
                  )}
                </div>
                {diagnosticCredit > 0 && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={applyCredit}
                      onChange={(e) => setApplyCredit(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Descontar el Diagnóstico Técnico ya pagado ({formatCurrency(diagnosticCredit)})
                  </label>
                )}
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-700">
                    Total de la venta:{" "}
                    <span className="font-semibold">
                      {quote.currency === "UF" && !factor ? "—" : formatCurrency(totalClp - descuento)}
                    </span>
                  </p>
                  <Button onClick={convertir} disabled={loading || (quote.currency === "UF" && !factor)}>
                    {loading ? "Convirtiendo…" : "Confirmar venta"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canManage && quote.status === "RECHAZADA" && (
        <div className="mt-6">
          {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button variant="secondary" onClick={() => cambiarEstado("BORRADOR")} disabled={loading}>
            Reabrir como borrador
          </Button>
        </div>
      )}
    </div>
  );
}
