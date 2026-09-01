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
import { formatCurrency, formatNumber } from "@/lib/utils";
import { PRODUCT_CATEGORIES } from "@/lib/product-categories";

interface StockLevel {
  id: string;
  quantity: number;
  warehouse: { id: string; name: string };
}

interface Variant {
  id: string;
  sku: string;
  attributes: string | null;
  price: string;
  cost: string;
  lowStockThreshold: number;
  active: boolean;
  stockLevels: StockLevel[];
}

interface ProductData {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  active: boolean;
  variants: Variant[];
}

export function ProductDetail({
  product,
  canManage,
}: {
  product: ProductData;
  canManage: boolean;
}) {
  const router = useRouter();

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/products" className="text-xs font-medium text-slate-400 hover:text-brand-700">
            ← Volver a productos
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-brand-900">{product.name}</h1>
        </div>
        <Badge tone={product.active ? "good" : "neutral"}>
          {product.active ? "Activo" : "Inactivo"}
        </Badge>
      </div>

      <ProductFields product={product} canManage={canManage} onSaved={() => router.refresh()} />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Variantes / SKU</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <Thead>
              <Tr>
                <Th>SKU</Th>
                <Th>Atributos</Th>
                <Th>Precio</Th>
                <Th>Costo</Th>
                <Th>Stock</Th>
                <Th>Umbral</Th>
                <Th>Estado</Th>
                {canManage && <Th></Th>}
              </Tr>
            </Thead>
            <Tbody>
              {product.variants.map((variant) => (
                <VariantRow
                  key={variant.id}
                  variant={variant}
                  canManage={canManage}
                  onSaved={() => router.refresh()}
                />
              ))}
            </Tbody>
          </Table>
        </CardContent>
      </Card>

      {canManage && (
        <div className="mt-6">
          <AddVariantForm productId={product.id} onSaved={() => router.refresh()} />
        </div>
      )}
    </div>
  );
}

function ProductFields({
  product,
  canManage,
  onSaved,
}: {
  product: ProductData;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(product.name);
  const [category, setCategory] = useState(product.category ?? "");
  const [description, setDescription] = useState(product.description ?? "");
  const [active, setActive] = useState(product.active);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, category, description, active }),
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
              <dt className="text-xs uppercase tracking-wide text-slate-400">Categoría</dt>
              <dd className="text-slate-700">{product.category || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Descripción</dt>
              <dd className="text-slate-700">{product.description || "—"}</dd>
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
        <div>
          <Label htmlFor="edit-name">Nombre</Label>
          <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="edit-category">Categoría</Label>
            <Select
              id="edit-category"
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
          <div className="flex items-end gap-2 pb-1">
            <input
              id="edit-active"
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <Label htmlFor="edit-active" className="mb-0">
              Producto activo
            </Label>
          </div>
        </div>
        <div>
          <Label htmlFor="edit-description">Descripción</Label>
          <Input
            id="edit-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
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

function VariantRow({
  variant,
  canManage,
  onSaved,
}: {
  variant: Variant;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [sku, setSku] = useState(variant.sku);
  const [attributes, setAttributes] = useState(variant.attributes ?? "");
  const [price, setPrice] = useState(variant.price);
  const [cost, setCost] = useState(variant.cost);
  const [threshold, setThreshold] = useState(String(variant.lowStockThreshold));
  const [active, setActive] = useState(variant.active);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const totalStock = variant.stockLevels.reduce((sum, l) => sum + l.quantity, 0);
  const lowStock = totalStock <= variant.lowStockThreshold;

  async function handleSave() {
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/variants/${variant.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku,
        attributes,
        price: Number(price) || 0,
        cost: Number(cost) || 0,
        lowStockThreshold: Number(threshold) || 0,
        active,
      }),
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

  if (editing) {
    return (
      <Tr>
        <Td colSpan={canManage ? 8 : 7}>
          <div className="grid grid-cols-6 gap-2 py-1">
            <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU" />
            <Input
              value={attributes}
              onChange={(e) => setAttributes(e.target.value)}
              placeholder="Atributos"
            />
            <Input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Precio"
            />
            <Input
              type="number"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="Costo"
            />
            <Input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="Umbral"
            />
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="text-xs text-slate-500">Activa</span>
            </div>
          </div>
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleSave} disabled={loading}>
              {loading ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </Td>
      </Tr>
    );
  }

  return (
    <Tr>
      <Td className="font-mono text-xs">{variant.sku}</Td>
      <Td>{variant.attributes || "—"}</Td>
      <Td>{formatCurrency(variant.price)}</Td>
      <Td>{formatCurrency(variant.cost)}</Td>
      <Td>
        <span className={lowStock ? "font-medium text-amber-700" : ""}>
          {formatNumber(totalStock)}
        </span>
        {lowStock && (
          <Badge tone="warn" className="ml-2">
            Bajo
          </Badge>
        )}
      </Td>
      <Td>{variant.lowStockThreshold}</Td>
      <Td>
        <Badge tone={variant.active ? "good" : "neutral"}>
          {variant.active ? "Activa" : "Inactiva"}
        </Badge>
      </Td>
      {canManage && (
        <Td>
          <button
            onClick={() => setEditing(true)}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            Editar
          </button>
        </Td>
      )}
    </Tr>
  );
}

function AddVariantForm({
  productId,
  onSaved,
}: {
  productId: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sku, setSku] = useState("");
  const [attributes, setAttributes] = useState("");
  const [price, setPrice] = useState("0");
  const [cost, setCost] = useState("0");
  const [threshold, setThreshold] = useState("5");
  const [initialQuantity, setInitialQuantity] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch(`/api/products/${productId}/variants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku,
        attributes,
        price: Number(price) || 0,
        cost: Number(cost) || 0,
        lowStockThreshold: Number(threshold) || 0,
        initialQuantity: Number(initialQuantity) || 0,
      }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo agregar la variante.");
      return;
    }

    setSku("");
    setAttributes("");
    setPrice("0");
    setCost("0");
    setThreshold("5");
    setInitialQuantity("0");
    setOpen(false);
    onSaved();
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        + Agregar variante
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nueva variante</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="new-sku">SKU</Label>
              <Input id="new-sku" required value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="new-attrs">Atributos</Label>
              <Input
                id="new-attrs"
                value={attributes}
                onChange={(e) => setAttributes(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="new-price">Precio</Label>
              <Input
                id="new-price"
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="new-cost">Costo</Label>
              <Input
                id="new-cost"
                type="number"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="new-threshold">Umbral stock bajo</Label>
              <Input
                id="new-threshold"
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="new-initial">Stock inicial</Label>
              <Input
                id="new-initial"
                type="number"
                value={initialQuantity}
                onChange={(e) => setInitialQuantity(e.target.value)}
              />
            </div>
          </div>
          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando…" : "Agregar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
