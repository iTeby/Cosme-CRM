"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuItem, DotsIcon } from "@/components/ui/dropdown-menu";
import { formatNumber } from "@/lib/utils";

interface StockLevel {
  quantity: number;
}

interface Variant {
  id: string;
  sku: string;
  active: boolean;
  lowStockThreshold: number;
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

// Quita tildes para que buscar "camara" encuentre "Cámara" sin obligar a
// escribir el acento.
function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function matches(product: ProductData, term: string) {
  if (!term) return true;
  const haystack = normalize(
    [product.name, product.category ?? "", ...product.variants.map((v) => v.sku)].join(" ")
  );
  return haystack.includes(normalize(term));
}

export function ProductsList({
  products,
  canManage,
}: {
  products: ProductData[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const filtered = useMemo(
    () => products.filter((p) => matches(p, search)),
    [products, search]
  );

  return (
    <div>
      <div className="border-b border-slate-100 p-4">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, SKU o categoría…"
          aria-label="Buscar productos"
        />
      </div>

      {products.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-500">
          Todavía no hay productos cargados.
          {canManage && " Crea el primero con el botón de arriba."}
        </p>
      ) : filtered.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-500">
          No se encontraron productos con ese criterio.
        </p>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Producto</Th>
              <Th>Categoría</Th>
              <Th>Variantes</Th>
              <Th>Stock total</Th>
              <Th>Estado</Th>
              {canManage && <Th>Acciones</Th>}
            </Tr>
          </Thead>
          <Tbody>
            {filtered.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                canManage={canManage}
                onChanged={() => router.refresh()}
              />
            ))}
          </Tbody>
        </Table>
      )}
    </div>
  );
}

function ProductRow({
  product,
  canManage,
  onChanged,
}: {
  product: ProductData;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalStock = product.variants.reduce(
    (sum, v) => sum + v.stockLevels.reduce((s, l) => s + l.quantity, 0),
    0
  );
  const hasLowStock = product.variants.some((v) => {
    const qty = v.stockLevels.reduce((s, l) => s + l.quantity, 0);
    return qty <= v.lowStockThreshold;
  });

  async function handleToggleActive() {
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: product.name,
        description: product.description ?? "",
        category: product.category ?? "",
        active: !product.active,
      }),
    });
    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo actualizar el producto.");
      return;
    }

    onChanged();
  }

  async function handleDelete() {
    if (
      !window.confirm(
        `¿Eliminar el producto "${product.name}"? Esta acción no se puede deshacer.`
      )
    ) {
      return;
    }
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/products/${product.id}`, { method: "DELETE" });
    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo eliminar el producto.");
      return;
    }

    onChanged();
  }

  return (
    <Tr>
      <Td>
        <Link
          href={`/products/${product.id}`}
          className="font-medium text-brand-700 hover:underline"
        >
          {product.name}
        </Link>
        <p className="text-xs text-slate-400">
          {product.variants.length} {product.variants.length === 1 ? "SKU" : "SKUs"}:{" "}
          {product.variants.map((v) => v.sku).join(", ")}
        </p>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </Td>
      <Td>{product.category || "—"}</Td>
      <Td>{product.variants.length}</Td>
      <Td>
        <span className={hasLowStock ? "font-medium text-amber-700" : ""}>
          {formatNumber(totalStock)}
        </span>
        {hasLowStock && (
          <Badge tone="warn" className="ml-2">
            Stock bajo
          </Badge>
        )}
      </Td>
      <Td>
        <Badge tone={product.active ? "good" : "neutral"}>
          {product.active ? "Activo" : "Inactivo"}
        </Badge>
      </Td>
      {canManage && (
        <Td>
          <DropdownMenu trigger={<DotsIcon />} label={`Acciones para ${product.name}`}>
            <DropdownMenuItem onClick={handleToggleActive} disabled={loading}>
              {product.active ? "Bloquear" : "Activar"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDelete} disabled={loading} danger>
              Eliminar
            </DropdownMenuItem>
          </DropdownMenu>
        </Td>
      )}
    </Tr>
  );
}
