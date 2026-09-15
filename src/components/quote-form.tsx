"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CURRENCIES, currencyLabels, formatQuoteAmount, type Currency } from "@/lib/quotes";

interface Customer {
  id: string;
  name: string;
}

interface Variant {
  id: string;
  sku: string;
  price: string;
  product: { name: string; pricingType: string };
}

interface Line {
  variantId: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

function lineFrom(variant: Variant | undefined): Line {
  return {
    variantId: variant?.id ?? "",
    description: variant?.product.name ?? "",
    quantity: "1",
    unitPrice: variant?.price ?? "0",
  };
}

function isoIn(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Formulario de cotización. Cada línea nace de un ítem del catálogo (así el
// reporte sabe qué se vende), pero la descripción y el precio se editan: un
// proyecto a medida se describe acá mismo.
export function QuoteForm({
  customers,
  variants,
  defaultCustomerId,
}: {
  customers: Customer[];
  variants: Variant[];
  defaultCustomerId?: string;
}) {
  const router = useRouter();
  const variantsById = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants]);

  const [customerId, setCustomerId] = useState(
    customers.some((c) => c.id === defaultCustomerId) ? (defaultCustomerId as string) : customers[0]?.id ?? ""
  );
  const [currency, setCurrency] = useState<Currency>("CLP");
  const [validUntil, setValidUntil] = useState(isoIn(15));
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Line[]>([lineFrom(variants[0])]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function updateLine(index: number, patch: Partial<Line>) {
    setItems((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function changeVariant(index: number, variantId: string) {
    const v = variantsById.get(variantId);
    updateLine(index, { variantId, description: v?.product.name ?? "", unitPrice: v?.price ?? "0" });
  }

  const total = items.reduce(
    (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0),
    0
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId,
        currency,
        validUntil,
        notes,
        items: items.map((l) => ({
          variantId: l.variantId,
          description: l.description,
          quantity: Number(l.quantity) || 0,
          unitPrice: Number(l.unitPrice) || 0,
        })),
      }),
    });
    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo guardar la cotización.");
      return;
    }
    const quote = await res.json();
    router.push(`/quotes/${quote.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-brand-900">Nueva cotización</h1>
        <p className="text-sm text-slate-500">
          Precios netos, sin IVA. La cotización queda en borrador hasta que la marques enviada.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cliente y condiciones</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label htmlFor="q-customer">Cliente</Label>
            <Select id="q-customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="q-currency">Moneda</Label>
            <Select id="q-currency" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {currencyLabels[c]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="q-valid">Válida hasta</Label>
            <Input id="q-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="q-notes">Notas para el cliente</Label>
            <Input id="q-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Líneas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {items.map((line, index) => (
            <div key={index} className="rounded-lg border border-slate-200 p-4">
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-12 md:col-span-5">
                  <Label htmlFor={`q-item-${index}`}>Ítem del catálogo</Label>
                  <Select
                    id={`q-item-${index}`}
                    value={line.variantId}
                    onChange={(e) => changeVariant(index, e.target.value)}
                  >
                    {variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.product.name} — {v.sku}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="col-span-6 md:col-span-2">
                  <Label htmlFor={`q-qty-${index}`}>Cantidad</Label>
                  <Input
                    id={`q-qty-${index}`}
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={line.quantity}
                    onChange={(e) => updateLine(index, { quantity: e.target.value })}
                  />
                </div>
                <div className="col-span-6 md:col-span-3">
                  <Label htmlFor={`q-price-${index}`}>Precio unitario ({currency})</Label>
                  <Input
                    id={`q-price-${index}`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.unitPrice}
                    onChange={(e) => updateLine(index, { unitPrice: e.target.value })}
                  />
                </div>
                <div className="col-span-12 flex items-end justify-between md:col-span-2 md:flex-col md:items-end">
                  <span className="text-xs text-slate-400">Subtotal</span>
                  <span className="text-sm font-medium">
                    {formatQuoteAmount((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0), currency)}
                  </span>
                </div>
                <div className="col-span-12">
                  <Label htmlFor={`q-desc-${index}`}>Descripción</Label>
                  <textarea
                    id={`q-desc-${index}`}
                    value={line.description}
                    onChange={(e) => updateLine(index, { description: e.target.value })}
                    rows={2}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>
              {items.length > 1 && (
                <div className="mt-2 flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                  >
                    Quitar línea
                  </Button>
                </div>
              )}
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => setItems((prev) => [...prev, lineFrom(variants[0])])}>
            Agregar línea
          </Button>
        </CardContent>
      </Card>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex items-center justify-between">
        <p className="text-lg font-semibold text-brand-900">Total neto: {formatQuoteAmount(total, currency)}</p>
        <div className="flex gap-3">
          <Button type="button" variant="secondary" onClick={() => router.back()} disabled={loading}>
            Cancelar
          </Button>
          <Button type="submit" disabled={loading || items.length === 0}>
            {loading ? "Guardando…" : "Guardar cotización"}
          </Button>
        </div>
      </div>
    </form>
  );
}
