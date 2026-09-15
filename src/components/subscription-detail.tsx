"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { formatQuoteAmount, type Currency } from "@/lib/quotes";
import { paymentStateLabels, paymentStateOf, paymentStateTone, type SaleStatus } from "@/lib/sales";
import {
  daysUntil,
  subscriptionDisplayState,
  subscriptionStateLabels,
  subscriptionStateTone,
  type SubscriptionStatus,
} from "@/lib/subscriptions";

interface HourLog {
  id: string;
  hours: string;
  description: string;
  loggedAt: string;
  createdBy: { name: string | null };
}

interface SubscriptionData {
  id: string;
  name: string;
  status: SubscriptionStatus;
  currency: Currency;
  amount: string;
  startsAt: string;
  renewsAt: string;
  hoursIncluded: number;
  hoursUsed: string;
  notes: string | null;
  customer: { id: string; name: string; contactName: string | null };
  sale: { id: string; number: number; totalAmount: string; paidAmount: string; status: SaleStatus } | null;
  hourLogs: HourLog[];
}

export function SubscriptionDetail({
  subscription,
  canManage,
  canRenew,
}: {
  subscription: SubscriptionData;
  canManage: boolean;
  canRenew: boolean;
}) {
  const router = useRouter();
  const sub = subscription;
  const estado = subscriptionDisplayState(sub.status, sub.renewsAt);
  const dias = daysUntil(sub.renewsAt);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sub.name);
  const [amount, setAmount] = useState(sub.amount);
  const [renewsAt, setRenewsAt] = useState(sub.renewsAt.slice(0, 10));
  const [hoursIncluded, setHoursIncluded] = useState(String(sub.hoursIncluded));
  const [notes, setNotes] = useState(sub.notes ?? "");
  const [status, setStatus] = useState<SubscriptionStatus>(sub.status);

  const [hours, setHours] = useState("");
  const [description, setDescription] = useState("");
  const [ufValue, setUfValue] = useState("");
  const [renewing, setRenewing] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function guardar() {
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/subscriptions/${sub.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        amount: Number(amount) || 0,
        renewsAt,
        hoursIncluded: Number(hoursIncluded) || 0,
        notes,
        status,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo guardar.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function registrarHoras(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/subscriptions/${sub.id}/hours`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours: Number(hours) || 0, description }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudieron registrar las horas.");
      return;
    }
    setHours("");
    setDescription("");
    router.refresh();
  }

  async function renovar() {
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/subscriptions/${sub.id}/renew`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ufValue: sub.currency === "UF" ? Number(ufValue) || undefined : undefined }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo renovar.");
      return;
    }
    const data = await res.json();
    router.push(`/sales/${data.sale.id}`);
    router.refresh();
  }

  const pagoVenta = sub.sale ? paymentStateOf(sub.sale.totalAmount, sub.sale.paidAmount) : null;

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <Link href="/subscriptions" className="text-xs font-medium text-slate-400 hover:text-brand-700">
            ← Volver a suscripciones
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-brand-900">{sub.name}</h1>
          <p className="text-sm text-slate-500">
            <Link href={`/customers/${sub.customer.id}`} className="font-medium text-brand-700 hover:underline">
              {sub.customer.name}
            </Link>
            {sub.customer.contactName ? ` · ${sub.customer.contactName}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-slate-400">Monto anual neto</p>
            <p className="text-lg font-semibold text-brand-900">{formatQuoteAmount(sub.amount, sub.currency)}</p>
          </div>
          <Badge tone={subscriptionStateTone[estado]}>{subscriptionStateLabels[estado]}</Badge>
        </div>
      </div>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <Card>
        {!editing ? (
          <CardContent className="flex items-start justify-between py-4">
            <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Inicio</dt>
                <dd className="text-slate-700">{formatDate(sub.startsAt)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Renueva</dt>
                <dd className={estado === "VENCIDA" ? "text-red-700" : "text-slate-700"}>
                  {formatDate(sub.renewsAt)}
                  {sub.status === "ACTIVA" && (
                    <span className="block text-xs text-slate-500">
                      {dias < 0 ? `venció hace ${-dias} días` : `faltan ${dias} días`}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Horas</dt>
                <dd className="text-slate-700">
                  {sub.hoursIncluded > 0 ? `${Number(sub.hoursUsed)} usadas de ${sub.hoursIncluded}` : "Sin bolsa de horas"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Venta que la cobra</dt>
                <dd className="text-slate-700">
                  {sub.sale ? (
                    <>
                      <Link href={`/sales/${sub.sale.id}`} className="font-medium text-brand-700 hover:underline">
                        #{sub.sale.number}
                      </Link>{" "}
                      <span className="text-xs text-slate-500">{formatCurrency(sub.sale.totalAmount)}</span>{" "}
                      {pagoVenta && sub.sale.status !== "ANULADA" && (
                        <Badge tone={paymentStateTone[pagoVenta]}>{paymentStateLabels[pagoVenta]}</Badge>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs uppercase tracking-wide text-slate-400">Notas</dt>
                <dd className="whitespace-pre-line text-slate-700">{sub.notes || "—"}</dd>
              </div>
            </dl>
            {canManage && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Editar
              </Button>
            )}
          </CardContent>
        ) : (
          <CardContent className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <div className="col-span-2 md:col-span-1">
                <Label htmlFor="es-name">Nombre</Label>
                <Input id="es-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="es-amount">Monto anual ({sub.currency})</Label>
                <Input id="es-amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="es-renews">Renueva el</Label>
                <Input id="es-renews" type="date" value={renewsAt} onChange={(e) => setRenewsAt(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="es-hours">Horas incluidas</Label>
                <Input id="es-hours" type="number" min="0" step="1" value={hoursIncluded} onChange={(e) => setHoursIncluded(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="es-status">Estado</Label>
                <Select id="es-status" value={status} onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}>
                  <option value="ACTIVA">Activa</option>
                  <option value="CANCELADA">Cancelada</option>
                </Select>
              </div>
              <div className="col-span-2 md:col-span-3">
                <Label htmlFor="es-notes">Notas</Label>
                <Input id="es-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setEditing(false)} disabled={loading}>
                Cancelar
              </Button>
              <Button onClick={guardar} disabled={loading}>
                {loading ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {canRenew && sub.status === "ACTIVA" && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Renovación</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-500">
              Renovar crea la venta del próximo año por {formatQuoteAmount(sub.amount, sub.currency)}, corre la
              fecha de renovación un año y pone las horas en cero. El pago se registra en la venta.
            </p>
            {!renewing ? (
              <Button variant="secondary" onClick={() => setRenewing(true)} disabled={loading}>
                Renovar un año
              </Button>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                {sub.currency === "UF" && (
                  <div>
                    <Label htmlFor="rn-uf">Valor de la UF hoy (CLP)</Label>
                    <Input id="rn-uf" type="number" min="1" step="0.01" value={ufValue} onChange={(e) => setUfValue(e.target.value)} />
                  </div>
                )}
                <Button onClick={renovar} disabled={loading || (sub.currency === "UF" && !(Number(ufValue) > 0))}>
                  {loading ? "Renovando…" : "Confirmar renovación"}
                </Button>
                <Button variant="ghost" onClick={() => setRenewing(false)} disabled={loading}>
                  Cancelar
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Horas trabajadas</CardTitle>
        </CardHeader>
        <CardContent>
          {canManage && sub.status === "ACTIVA" && (
            <form onSubmit={registrarHoras} className="mb-5 flex flex-wrap items-end gap-3">
              <div className="w-28">
                <Label htmlFor="h-hours">Horas</Label>
                <Input id="h-hours" type="number" min="0.25" step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} />
              </div>
              <div className="min-w-[16rem] flex-1">
                <Label htmlFor="h-desc">Qué se hizo</Label>
                <Input id="h-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <Button type="submit" disabled={loading}>
                Registrar
              </Button>
            </form>
          )}
          {sub.hourLogs.length === 0 ? (
            <p className="text-sm text-slate-500">Todavía no hay horas registradas en este periodo.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Fecha</Th>
                    <Th>Horas</Th>
                    <Th>Trabajo</Th>
                    <Th>Quién</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {sub.hourLogs.map((h) => (
                    <Tr key={h.id}>
                      <Td className="whitespace-nowrap text-xs text-slate-500">{formatDate(h.loggedAt)}</Td>
                      <Td className="font-medium">{Number(h.hours)}</Td>
                      <Td>{h.description}</Td>
                      <Td className="text-slate-500">{h.createdBy.name || "—"}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
