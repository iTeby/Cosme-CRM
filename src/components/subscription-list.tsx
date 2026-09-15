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
import { formatDate } from "@/lib/utils";
import { CURRENCIES, currencyLabels, formatQuoteAmount, type Currency } from "@/lib/quotes";
import {
  daysUntil,
  subscriptionDisplayState,
  subscriptionStateLabels,
  subscriptionStateTone,
  type SubscriptionStatus,
} from "@/lib/subscriptions";

interface SubscriptionRow {
  id: string;
  name: string;
  status: SubscriptionStatus;
  currency: Currency;
  amount: string;
  renewsAt: string;
  hoursIncluded: number;
  hoursUsed: string;
  customer: { id: string; name: string };
}

interface Customer {
  id: string;
  name: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function inOneYear(from: string): string {
  const d = new Date(from + "T00:00:00");
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export function SubscriptionList({
  subscriptions,
  customers,
  canManage,
  defaultCustomerId,
}: {
  subscriptions: SubscriptionRow[];
  customers: Customer[];
  canManage: boolean;
  defaultCustomerId?: string;
}) {
  const [showForm, setShowForm] = useState(Boolean(defaultCustomerId));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-brand-900">Suscripciones</h1>
          <p className="text-sm text-slate-500">
            Mantenciones y soportes anuales. Se avisa con 60 días de anticipación a la renovación.
          </p>
        </div>
        {canManage && customers.length > 0 && (
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cerrar" : "Nueva suscripción"}
          </Button>
        )}
      </div>

      {showForm && canManage && (
        <SubscriptionForm
          customers={customers}
          defaultCustomerId={defaultCustomerId}
          onDone={() => setShowForm(false)}
        />
      )}

      <Card>
        <CardContent className="p-0">
          {subscriptions.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">
              Todavía no hay suscripciones registradas.
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Suscripción</Th>
                  <Th>Cliente</Th>
                  <Th>Monto anual</Th>
                  <Th>Horas</Th>
                  <Th>Renueva</Th>
                  <Th>Estado</Th>
                </Tr>
              </Thead>
              <Tbody>
                {subscriptions.map((s) => {
                  const estado = subscriptionDisplayState(s.status, s.renewsAt);
                  const dias = daysUntil(s.renewsAt);
                  return (
                    <Tr key={s.id}>
                      <Td>
                        <Link href={`/subscriptions/${s.id}`} className="font-medium text-brand-700 hover:underline">
                          {s.name}
                        </Link>
                      </Td>
                      <Td>
                        <Link href={`/customers/${s.customer.id}`} className="hover:underline">
                          {s.customer.name}
                        </Link>
                      </Td>
                      <Td>{formatQuoteAmount(s.amount, s.currency)}</Td>
                      <Td className="text-slate-500">
                        {s.hoursIncluded > 0 ? `${Number(s.hoursUsed)} / ${s.hoursIncluded}` : "—"}
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-slate-500">
                        {formatDate(s.renewsAt)}
                        {s.status === "ACTIVA" && (
                          <span className="block">
                            {dias < 0 ? `hace ${-dias} días` : `en ${dias} días`}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={subscriptionStateTone[estado]}>{subscriptionStateLabels[estado]}</Badge>
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

function SubscriptionForm({
  customers,
  defaultCustomerId,
  onDone,
}: {
  customers: Customer[];
  defaultCustomerId?: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(
    customers.some((c) => c.id === defaultCustomerId) ? (defaultCustomerId as string) : customers[0]?.id ?? ""
  );
  const [name, setName] = useState("Mantención anual");
  const [currency, setCurrency] = useState<Currency>("CLP");
  const [amount, setAmount] = useState("");
  const [startsAt, setStartsAt] = useState(today());
  const [renewsAt, setRenewsAt] = useState(inOneYear(today()));
  const [hoursIncluded, setHoursIncluded] = useState("0");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId,
        name,
        currency,
        amount: Number(amount) || 0,
        startsAt,
        renewsAt,
        hoursIncluded: Number(hoursIncluded) || 0,
        notes,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo crear la suscripción.");
      return;
    }
    const sub = await res.json();
    onDone();
    router.push(`/subscriptions/${sub.id}`);
    router.refresh();
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Nueva suscripción</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="col-span-2 md:col-span-3">
            <Label htmlFor="s-customer">Cliente</Label>
            <Select id="s-customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="col-span-2 md:col-span-1">
            <Label htmlFor="s-name">Nombre</Label>
            <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="s-currency">Moneda</Label>
            <Select id="s-currency" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {currencyLabels[c]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="s-amount">Monto anual neto ({currency})</Label>
            <Input
              id="s-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="s-starts">Inicio</Label>
            <Input
              id="s-starts"
              type="date"
              value={startsAt}
              onChange={(e) => {
                setStartsAt(e.target.value);
                if (e.target.value) setRenewsAt(inOneYear(e.target.value));
              }}
            />
          </div>
          <div>
            <Label htmlFor="s-renews">Renueva el</Label>
            <Input id="s-renews" type="date" value={renewsAt} onChange={(e) => setRenewsAt(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="s-hours">Horas incluidas al año</Label>
            <Input
              id="s-hours"
              type="number"
              min="0"
              step="1"
              value={hoursIncluded}
              onChange={(e) => setHoursIncluded(e.target.value)}
            />
          </div>
          <div className="col-span-2 md:col-span-3">
            <Label htmlFor="s-notes">Notas</Label>
            <Input id="s-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Qué incluye, condiciones…" />
          </div>
          {error && (
            <p className="col-span-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 md:col-span-3">{error}</p>
          )}
          <div className="col-span-2 flex justify-end gap-3 md:col-span-3">
            <Button type="button" variant="secondary" onClick={onDone} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando…" : "Crear suscripción"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
