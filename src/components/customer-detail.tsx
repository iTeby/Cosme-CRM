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
import { round2 } from "@/lib/decimal";
import {
  outstanding,
  paymentStateLabels,
  paymentStateOf,
  paymentStateTone,
  saleStatusLabels,
  saleStatusTone,
  type SaleStatus,
} from "@/lib/sales";
import { paymentMethodLabels, type PaymentMethod } from "@/lib/payments";
import { PaymentForm } from "@/components/payment-form";

interface SaleItemRow {
  id: string;
  quantity: number | string;
}

interface SaleRow {
  id: string;
  number: number;
  status: SaleStatus;
  totalAmount: string;
  paidAmount: string;
  createdAt: string;
  items: SaleItemRow[];
}

interface PaymentRow {
  id: string;
  amount: string;
  method: PaymentMethod;
  notes: string | null;
  createdAt: string;
  sale: { number: number } | null;
  createdBy: { name: string | null };
}

interface CustomerData {
  id: string;
  name: string;
  taxId: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  sales: SaleRow[];
  payments: PaymentRow[];
}

export function CustomerDetail({
  customer,
  canManage,
  canViewPayments,
  canManagePayments,
  cashShiftOpen,
}: {
  customer: CustomerData;
  canManage: boolean;
  canViewPayments: boolean;
  canManagePayments: boolean;
  cashShiftOpen: boolean;
}) {
  const router = useRouter();
  const [pagoError, setPagoError] = useState<string | null>(null);

  // La libreta de fiados: lo que el cliente debe hoy. Una venta anulada no se
  // cobra, así que no suma, igual que en payAccount() del servidor.
  const deuda = round2(
    customer.sales
      .filter((venta) => venta.status !== "ANULADA")
      .reduce((acc, venta) => acc + outstanding(venta.totalAmount, venta.paidAmount), 0)
  );

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

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <Link href="/customers" className="text-xs font-medium text-slate-400 hover:text-brand-700">
            ← Volver a clientes
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-brand-900">{customer.name}</h1>
        </div>
        <div className="flex items-center gap-6">
          {canViewPayments && (
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate-400">Deuda</p>
              <p
                className={
                  deuda > 0
                    ? "text-lg font-semibold text-red-700"
                    : "text-lg font-semibold text-emerald-700"
                }
              >
                {formatCurrency(deuda)}
              </p>
            </div>
          )}
          <Badge tone={customer.active ? "good" : "neutral"}>
            {customer.active ? "Activo" : "Inactivo"}
          </Badge>
        </div>
      </div>

      <CustomerFields customer={customer} canManage={canManage} onSaved={() => router.refresh()} />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Historial de compras</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {customer.sales.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">
              Este cliente todavía no tiene ventas registradas.
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Venta</Th>
                  <Th>Fecha</Th>
                  <Th>Líneas</Th>
                  <Th>Total</Th>
                  {canViewPayments && <Th>Abonado</Th>}
                  {canViewPayments && <Th>Saldo</Th>}
                  <Th>Estado</Th>
                  {canViewPayments && <Th>Pago</Th>}
                </Tr>
              </Thead>
              <Tbody>
                {customer.sales.map((venta) => {
                  const saldo = outstanding(venta.totalAmount, venta.paidAmount);
                  const anulada = venta.status === "ANULADA";
                  const estadoPago = paymentStateOf(venta.totalAmount, venta.paidAmount);
                  return (
                    <Tr key={venta.id}>
                      <Td>
                        <Link
                          href={`/sales/${venta.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          #{venta.number}
                        </Link>
                      </Td>
                      <Td className="text-xs text-slate-500">{formatDate(venta.createdAt)}</Td>
                      <Td>{venta.items.length}</Td>
                      <Td>{formatCurrency(venta.totalAmount)}</Td>
                      {canViewPayments && <Td>{formatCurrency(venta.paidAmount)}</Td>}
                      {canViewPayments && (
                        <Td className={saldo > 0 && !anulada ? "font-medium text-red-700" : ""}>
                          {anulada ? "—" : formatCurrency(saldo)}
                        </Td>
                      )}
                      <Td>
                        <Badge tone={saleStatusTone[venta.status]}>
                          {saleStatusLabels[venta.status]}
                        </Badge>
                      </Td>
                      {canViewPayments && (
                        <Td>
                          {anulada ? (
                            <span className="text-xs text-slate-400">—</span>
                          ) : (
                            <Badge tone={paymentStateTone[estadoPago]}>
                              {paymentStateLabels[estadoPago]}
                            </Badge>
                          )}
                        </Td>
                      )}
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canViewPayments && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Abonos</CardTitle>
          </CardHeader>
          <CardContent>
            {customer.payments.length === 0 ? (
              <p className="mb-5 text-sm text-slate-500">
                Este cliente todavía no tiene abonos registrados.
              </p>
            ) : (
              <div className="mb-5 overflow-hidden rounded-lg border border-slate-200">
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Fecha</Th>
                      <Th>Monto</Th>
                      <Th>Medio</Th>
                      <Th>Venta</Th>
                      <Th>Nota</Th>
                      <Th>Quién</Th>
                      {canManagePayments && <Th />}
                    </Tr>
                  </Thead>
                  <Tbody>
                    {customer.payments.map((pago) => (
                      <Tr key={pago.id}>
                        <Td className="whitespace-nowrap text-xs text-slate-500">
                          {formatDate(pago.createdAt)}
                        </Td>
                        <Td className="font-medium">{formatCurrency(pago.amount)}</Td>
                        <Td>{paymentMethodLabels[pago.method]}</Td>
                        <Td className="text-slate-500">
                          {pago.sale ? `#${pago.sale.number}` : "—"}
                        </Td>
                        <Td className="text-slate-500">{pago.notes || "—"}</Td>
                        <Td className="text-slate-500">{pago.createdBy.name || "—"}</Td>
                        {canManagePayments && (
                          <Td>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => deshacerPago(pago.id)}
                            >
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

            {deuda <= 0 ? (
              <p className="text-sm text-emerald-700">Este cliente no tiene deuda pendiente.</p>
            ) : canManagePayments ? (
              <div>
                <p className="mb-3 text-sm text-slate-500">
                  Abonar a cuenta: el monto se reparte desde la venta más antigua hacia la más
                  nueva, como una libreta de fiados.
                </p>
                <PaymentForm
                  customerId={customer.id}
                  saldo={deuda}
                  cashShiftOpen={cashShiftOpen}
                />
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                Debe {formatCurrency(deuda)}. No tienes permiso para registrar pagos.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CustomerFields({
  customer,
  canManage,
  onSaved,
}: {
  customer: CustomerData;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(customer.name);
  const [taxId, setTaxId] = useState(customer.taxId ?? "");
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [email, setEmail] = useState(customer.email ?? "");
  const [address, setAddress] = useState(customer.address ?? "");
  const [notes, setNotes] = useState(customer.notes ?? "");
  const [active, setActive] = useState(customer.active);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/customers/${customer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, taxId, phone, email, address, notes, active }),
    });
    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo guardar.");
      return;
    }

    setEditing(false);
    onSaved();
  }

  if (!editing) {
    return (
      <Card>
        <CardContent className="flex items-start justify-between py-4">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">RUT / ID</dt>
              <dd className="text-slate-700">{customer.taxId || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Teléfono</dt>
              <dd className="text-slate-700">{customer.phone || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Correo</dt>
              <dd className="text-slate-700">{customer.email || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Dirección</dt>
              <dd className="text-slate-700">{customer.address || "—"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs uppercase tracking-wide text-slate-400">Notas</dt>
              <dd className="text-slate-700">{customer.notes || "—"}</dd>
            </div>
          </dl>
          {canManage && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Editar
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="edit-c-name">Nombre</Label>
            <Input id="edit-c-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="edit-c-taxid">RUT / identificación</Label>
            <Input id="edit-c-taxid" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="edit-c-phone">Teléfono</Label>
            <Input id="edit-c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="edit-c-email">Correo</Label>
            <Input id="edit-c-email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="edit-c-address">Dirección</Label>
            <Input id="edit-c-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="edit-c-notes">Notas</Label>
            <Input id="edit-c-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex items-end gap-2 pb-1">
            <input
              id="edit-c-active"
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <Label htmlFor="edit-c-active" className="mb-0">
              Cliente activo
            </Label>
          </div>
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setEditing(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
