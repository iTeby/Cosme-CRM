"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

interface Supplier {
  id: string;
  name: string;
}

interface Variant {
  id: string;
  sku: string;
  attributes: string | null;
  cost: string;
  product: { name: string };
}

interface LineItem {
  variantId: string;
  quantity: string;
  unitCost: string;
}

function emptyLine(defaultVariantId: string, defaultCost: string): LineItem {
  return { variantId: defaultVariantId, quantity: "1", unitCost: defaultCost };
}

export function PurchaseForm({ suppliers, variants }: { suppliers: Supplier[]; variants: Variant[] }) {
  const router = useRouter();
  const variantsById = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants]);

  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([
    emptyLine(variants[0]?.id ?? "", variants[0]?.cost ?? "0"),
  ]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function updateLine(index: number, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function changeVariant(index: number, variantId: string) {
    const variant = variantsById.get(variantId);
    updateLine(index, { variantId, unitCost: variant?.cost ?? "0" });
  }

  function addLine() {
    setItems((prev) => [...prev, emptyLine(variants[0]?.id ?? "", variants[0]?.cost ?? "0")]);
  }

  function removeLine(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  const total = items.reduce(
    (sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitCost) || 0),
    0
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!supplierId) {
      setError("Selecciona un proveedor.");
      return;
    }

    setLoading(true);
    const res = await fetch("/api/purchases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierId,
        notes,
        items: items.map((line) => ({
          variantId: line.variantId,
          quantity: Number(line.quantity) || 0,
          unitCost: Number(line.unitCost) || 0,
        })),
      }),
    });
    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo registrar la compra.");
      return;
    }

    const purchase = await res.json();
    router.push(`/purchases/${purchase.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-brand-900">Nueva compra</h1>
        <p className="text-sm text-slate-500">
          Al guardar queda pendiente; el stock se agrega recién cuando la marques como recibida.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Proveedor</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="purchase-supplier">Proveedor</Label>
            <Select
              id="purchase-supplier"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="purchase-notes">Notas</Label>
            <Input
              id="purchase-notes"
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
          {items.map((line, index) => (
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
                  <Label htmlFor={`p-item-variant-${index}`}>Producto (SKU)</Label>
                  <Select
                    id={`p-item-variant-${index}`}
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
                <div>
                  <Label htmlFor={`p-item-qty-${index}`}>Cantidad</Label>
                  <Input
                    id={`p-item-qty-${index}`}
                    type="number"
                    min="1"
                    step="1"
                    value={line.quantity}
                    onChange={(e) => updateLine(index, { quantity: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor={`p-item-cost-${index}`}>Costo unitario</Label>
                  <Input
                    id={`p-item-cost-${index}`}
                    type="number"
                    min="0"
                    step="1"
                    value={line.unitCost}
                    onChange={(e) => updateLine(index, { unitCost: e.target.value })}
                  />
                </div>
              </div>
              <p className="mt-2 text-right text-sm text-slate-500">
                Subtotal:{" "}
                <span className="font-medium text-slate-800">
                  {formatCurrency((Number(line.quantity) || 0) * (Number(line.unitCost) || 0))}
                </span>
              </p>
            </div>
          ))}
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
          {loading ? "Guardando…" : "Registrar compra"}
        </Button>
      </div>
    </form>
  );
}
