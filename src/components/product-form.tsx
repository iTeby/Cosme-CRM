"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PRODUCT_CATEGORIES } from "@/lib/product-categories";

interface VariantDraft {
  sku: string;
  attributes: string;
  price: string;
  cost: string;
  lowStockThreshold: string;
  initialQuantity: string;
}

function emptyVariant(): VariantDraft {
  return {
    sku: "",
    attributes: "",
    price: "0",
    cost: "0",
    lowStockThreshold: "5",
    initialQuantity: "0",
  };
}

export function ProductForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [variants, setVariants] = useState<VariantDraft[]>([emptyVariant()]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function updateVariant(index: number, patch: Partial<VariantDraft>) {
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  }

  function addVariant() {
    setVariants((prev) => [...prev, emptyVariant()]);
  }

  function removeVariant(index: number) {
    setVariants((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const payload = {
      name,
      description,
      category,
      variants: variants.map((v) => ({
        sku: v.sku,
        attributes: v.attributes,
        price: Number(v.price) || 0,
        cost: Number(v.cost) || 0,
        lowStockThreshold: Number(v.lowStockThreshold) || 0,
        initialQuantity: Number(v.initialQuantity) || 0,
      })),
    };

    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo crear el producto.");
      return;
    }

    const product = await res.json();
    router.push(`/products/${product.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Datos generales</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="name">Nombre del producto</Label>
            <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="category">Categoría</Label>
              <Select
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">Sin categoría</option>
                {PRODUCT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="description">Descripción</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Opcional"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Variantes / SKU</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {variants.map((variant, index) => (
            <div key={index} className="rounded-lg border border-slate-200 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Variante {index + 1}
                </p>
                {variants.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeVariant(index)}
                    className="text-xs font-medium text-red-600 hover:underline"
                  >
                    Quitar
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor={`sku-${index}`}>SKU</Label>
                  <Input
                    id={`sku-${index}`}
                    required
                    value={variant.sku}
                    onChange={(e) => updateVariant(index, { sku: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor={`attrs-${index}`}>Atributos</Label>
                  <Input
                    id={`attrs-${index}`}
                    placeholder="Ej: Talla M, Azul"
                    value={variant.attributes}
                    onChange={(e) => updateVariant(index, { attributes: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor={`price-${index}`}>Precio de venta</Label>
                  <Input
                    id={`price-${index}`}
                    type="number"
                    min="0"
                    step="1"
                    value={variant.price}
                    onChange={(e) => updateVariant(index, { price: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor={`cost-${index}`}>Costo</Label>
                  <Input
                    id={`cost-${index}`}
                    type="number"
                    min="0"
                    step="1"
                    value={variant.cost}
                    onChange={(e) => updateVariant(index, { cost: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor={`threshold-${index}`}>Umbral de stock bajo</Label>
                  <Input
                    id={`threshold-${index}`}
                    type="number"
                    min="0"
                    step="1"
                    value={variant.lowStockThreshold}
                    onChange={(e) => updateVariant(index, { lowStockThreshold: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor={`initial-${index}`}>Stock inicial</Label>
                  <Input
                    id={`initial-${index}`}
                    type="number"
                    min="0"
                    step="1"
                    value={variant.initialQuantity}
                    onChange={(e) => updateVariant(index, { initialQuantity: e.target.value })}
                  />
                </div>
              </div>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={addVariant}>
            + Agregar otra variante
          </Button>
        </CardContent>
      </Card>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Guardando…" : "Crear producto"}
        </Button>
      </div>
    </form>
  );
}
