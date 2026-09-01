"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatNumber } from "@/lib/utils";

interface Customer {
  id: string;
  name: string;
}

interface Variant {
  id: string;
  sku: string;
  attributes: string | null;
  price: string;
  product: { name: string };
  stockLevels: { quantity: number }[];
}

interface LineItem {
  variantId: string;
  quantity: string;
  unitPrice: string;
}

function emptyLine(defaultVariantId: string, defaultPrice: string): LineItem {
  return { variantId: defaultVariantId, quantity: "1", unitPrice: defaultPrice };
}

export function SaleForm({ customers, variants }: { customers: Customer[]; variants: Variant[] }) {
  const router = useRouter();
  const variantsById = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants]);

  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([
    emptyLine(variants[0]?.id ?? "", variants[0]?.price ?? "0"),
  ]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function stockFor(variantId: string) {
    const variant = variantsById.get(variantId);
    if (!variant) return 0;
    return variant.stockLevels.reduce((sum, l) => sum + l.quantity, 0);
  }

  function updateLine(index: number, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function changeVariant(index: number, variantId: string) {
    const variant = variantsById.get(variantId);
    updateLine(index, { variantId, unitPrice: variant?.price ?? "0" });
  }

  function addLine() {
    setItems((prev) => [...prev, emptyLine(variants[0]?.id ?? "", variants[0]?.price ?? "0")]);
  }

  function removeLine(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  const total = items.reduce(
    (sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0),
    0
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!customerId) {
      setError("Selecciona un cliente.");
      return;
    }

    setLoading(true);
    const res = await fetch("/api/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId,
        notes,
        items: items.map((line) => ({
          variantId: line.variantId,
          quantity: Number(line.quantity) || 0,
          unitPrice: Number(line.unitPrice) || 0,
        })),
      }),
    });
    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo registrar la venta.");
      return;
    }

    const sale = await res.json();
    router.push(`/sales/${sale.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-brand-900">Nueva venta</h1>
        <p className="text-sm text-slate-500">
          Al guardar, se descuenta el stock de cada línea automáticamente.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cliente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="sale-customer">Cliente</Label>
            <Select
              id="sale-customer"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="sale-notes">Notas</Label>
            <Input
              id="sale-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Opcional"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Productos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {items.map((line, index) => {
            const available = stockFor(line.variantId);
            const wanted = Number(line.quantity) || 0;
            const overStock = wanted > available;

            return (
              <div key={index} className="rounded-lg border border-slate-200 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Línea {index + 1}
                  </p>
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLine(index)}
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Quitar
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-3">
                  <div className="col-span-2">
                    <Label htmlFor={`item-variant-${index}`}>Producto (SKU)</Label>
                    <Select
                      id={`item-variant-${index}`}
                      value={line.variantId}
                      onChange={(e) => changeVariant(index, e.target.value)}
                    >
                      {variants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.product.name} — {v.sku}
                        </option>
                      ))}
                    </Select>
                    <p className="mt-1 text-xs text-slate-400">
                      Stock disponible: {formatNumber(available)}
                    </p>
                  </div>
                  <div>
                    <Label htmlFor={`item-qty-${index}`}>Cantidad</Label>
                    <Input
                      id={`item-qty-${index}`}
                      type="number"
                      min="1"
                      step="1"
                      value={line.quantity}
                      onChange={(e) => updateLine(index, { quantity: e.target.value })}
                    />
                    {overStock && (
                      <p className="mt-1 text-xs text-red-600">Supera el stock disponible</p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor={`item-price-${index}`}>Precio unitario</Label>
                    <Input
                      id={`item-price-${index}`}
                      type="number"
                      min="0"
                      step="1"
                      value={line.unitPrice}
                      onChange={(e) => updateLine(index, { unitPrice: e.target.value })}
                    />
                  </div>
                </div>
                <p className="mt-2 text-right text-sm text-slate-500">
                  Subtotal:{" "}
                  <span className="font-medium text-slate-800">
                    {formatCurrency((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0))}
                  </span>
                </p>
              </div>
            );
          })}
          <Button type="button" variant="secondary" onClick={addLine}>
            + Agregar otro producto
          </Button>

          <div className="flex justify-end border-t border-slate-100 pt-4">
            <p className="text-base font-semibold text-brand-900">
              Total: {formatCurrency(total)}
            </p>
          </div>
        </CardContent>
      </Card>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Guardando…" : "Registrar venta"}
        </Button>
      </div>
    </form>
  );
}
