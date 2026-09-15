"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { formatQuantity } from "@/lib/decimal";
import {
  outstanding,
  paymentStateLabels,
  paymentStateOf,
  paymentStateTone,
  saleStatusLabels,
  saleStatusTone,
  saleStatusTransitions,
  type SaleStatus,
} from "@/lib/sales";
import { paymentMethodLabels, type PaymentMethod } from "@/lib/payments";
import { PaymentForm } from "@/components/payment-form";
import { DteCard, type DteRow } from "@/components/dte-card";
import { InvoiceCard, type InvoiceRow } from "@/components/invoice-card";

interface SaleItem {
  id: string;
  quantity: number | string;
  unitPrice: string;
  subtotal: string;
  variant: {
    sku: string;
    attributes: string | null;
    product: { name: string };
  };
}

interface PaymentRow {
  id: string;
  amount: string;
  method: PaymentMethod;
  notes: string | null;
  createdAt: string;
  createdBy: { name: string | null };
}

interface SaleData {
  id: string;
  number: number;
  status: SaleStatus;
  totalAmount: string;
  paidAmount: string;
  discountAmount: string;
  purchaseOrder: string | null;
  payments: PaymentRow[];
  invoices: InvoiceRow[];
  notes: string | null;
  createdAt: string;
  customer: { id: string; name: string; taxId: string | null };
  createdBy: { name: string | null };
  items: SaleItem[];
}

const statusButtonLabel: Record<SaleStatus, string> = {
  PENDIENTE: "Volver a pendiente",
  ENTREGADA: "Marcar como entregada",
  ANULADA: "Anular venta",
};

export function SaleDetail({
  sale,
  canManage,
  canViewPayments,
  canManagePayments,
  cashShiftOpen,
  canManageInvoices,
  dte,
}: {
  sale: SaleData;
  canManage: boolean;
  /** Bodega entra al detalle para preparar entregas, pero no ve caja. */
  canViewPayments: boolean;
  canManagePayments: boolean;
  cashShiftOpen: boolean;
  canManageInvoices: boolean;
  /** Null cuando el rol no puede ver documentos tributarios. */
  dte: {
    rows: DteRow[];
    environment: string;
    provider: string;
    canManage: boolean;
  } | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pagoError, setPagoError] = useState<string | null>(null);

  const saldo = outstanding(sale.totalAmount, sale.paidAmount);
  const estadoPago = paymentStateOf(sale.totalAmount, sale.paidAmount);
  const anulada = sale.status === "ANULADA";

  async function deshacerPago(id: string) {
    setPagoError(null);
    const res = await fetch(`/api/payments/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setPagoError(typeof data.error === "string" ? data.error : "No se pudo deshacer el pago.");
      return;
    }
    router.refresh();
  }

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
            <p className="text-xs uppercase tracking-wide text-slate-400">Orden de compra</p>
            <p className="text-slate-700">{sale.purchaseOrder || "—"}</p>
          </div>
          {Number(sale.discountAmount) > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Descuento aplicado</p>
              <p className="text-slate-700">{formatCurrency(sale.discountAmount)} (crédito de Diagnóstico)</p>
            </div>
          )}
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Notas</p>
            <p className="text-slate-700">{sale.notes || "—"}</p>
          </div>
        </CardContent>
      </Card>

      {canViewPayments && (
        <InvoiceCard
          saleId={sale.id}
          saleTotal={sale.totalAmount}
          salePaid={sale.paidAmount}
          invoices={sale.invoices}
          canManage={canManageInvoices && !anulada}
        />
      )}

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
                  <Td>{formatQuantity(item.quantity)}</Td>
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

      {canViewPayments && (
        <Card className="mt-6">
        <CardHeader>
          <CardTitle>Pagos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-5 flex flex-wrap gap-8">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Total</p>
              <p className="text-base font-semibold text-brand-900">
                {formatCurrency(sale.totalAmount)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Abonado</p>
              <p className="text-base font-semibold text-brand-900">
                {formatCurrency(sale.paidAmount)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Saldo</p>
              <p
                className={
                  saldo > 0
                    ? "text-base font-semibold text-red-700"
                    : "text-base font-semibold text-emerald-700"
                }
              >
                {formatCurrency(saldo)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Estado del pago</p>
              <Badge tone={paymentStateTone[estadoPago]}>{paymentStateLabels[estadoPago]}</Badge>
            </div>
          </div>

          {sale.payments.length > 0 && (
            <div className="mb-5 overflow-hidden rounded-lg border border-slate-200">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Fecha</Th>
                    <Th>Monto</Th>
                    <Th>Medio</Th>
                    <Th>Nota</Th>
                    <Th>Quién</Th>
                    {canManagePayments && <Th />}
                  </Tr>
                </Thead>
                <Tbody>
                  {sale.payments.map((pago) => (
                    <Tr key={pago.id}>
                      <Td className="whitespace-nowrap text-xs text-slate-500">
                        {formatDate(pago.createdAt)}
                      </Td>
                      <Td className="font-medium">{formatCurrency(pago.amount)}</Td>
                      <Td>{paymentMethodLabels[pago.method]}</Td>
                      <Td className="text-slate-500">{pago.notes || "—"}</Td>
                      <Td className="text-slate-500">{pago.createdBy.name || "—"}</Td>
                      {canManagePayments && (
                        <Td>
                          <Button type="button" variant="ghost" onClick={() => deshacerPago(pago.id)}>
                            Deshacer
                          </Button>
                        </Td>
                      )}
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          )}

          {pagoError && (
            <p className="mb-4 text-sm text-red-600" role="alert">
              {pagoError}
            </p>
          )}

          {anulada ? (
            <p className="text-sm text-slate-500">Esta venta está anulada.</p>
          ) : saldo <= 0 ? (
            <p className="text-sm text-emerald-700">Esta venta está pagada por completo.</p>
          ) : canManagePayments ? (
            <PaymentForm saleId={sale.id} saldo={saldo} cashShiftOpen={cashShiftOpen} />
          ) : (
            <p className="text-sm text-slate-500">
              Queda un saldo de {formatCurrency(saldo)}. No tienes permiso para registrar pagos.
            </p>
          )}
        </CardContent>
        </Card>
      )}

      {dte && (
        <DteCard
          saleId={sale.id}
          dtes={dte.rows}
          environment={dte.environment}
          provider={dte.provider}
          clienteTieneRut={Boolean(sale.customer.taxId)}
          canManage={dte.canManage}
          ventaAnulada={anulada}
        />
      )}

      {canManage && nextStatuses.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Cambiar estado</CardTitle>
          </CardHeader>
          <CardContent>
            {sale.status !== "ANULADA" && (
              <p className="mb-3 text-xs text-slate-500">
                Anular esta venta repone el stock que hubiera descontado (los servicios no
                descuentan). Si tiene abonos registrados, hay que deshacerlos antes.
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
