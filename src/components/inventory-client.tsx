"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuItem, DotsIcon } from "@/components/ui/dropdown-menu";
import { formatDate, formatNumber } from "@/lib/utils";

interface Variant {
  id: string;
  sku: string;
  lowStockThreshold: number;
  product: { name: string };
  stockLevels: { quantity: number; warehouseId: string }[];
}

interface Warehouse {
  id: string;
  name: string;
  isDefault: boolean;
}

interface Movement {
  id: string;
  type: "ENTRADA" | "SALIDA" | "AJUSTE";
  quantity: number;
  reason: string | null;
  createdAt: string;
  variant: { sku: string; product: { name: string } };
  warehouse: { name: string };
  user: { name: string | null };
  saleId: string | null;
  purchaseId: string | null;
}

const typeLabels: Record<Movement["type"], string> = {
  ENTRADA: "Entrada",
  SALIDA: "Salida",
  AJUSTE: "Ajuste",
};

const typeTone: Record<Movement["type"], "good" | "critical" | "neutral"> = {
  ENTRADA: "good",
  SALIDA: "critical",
  AJUSTE: "neutral",
};

export function InventoryClient({
  variants,
  warehouses,
  movements,
  canManage,
  canEditMovements,
}: {
  variants: Variant[];
  warehouses: Warehouse[];
  movements: Movement[];
  canManage: boolean;
  canEditMovements: boolean;
}) {
  const router = useRouter();

  const lowStock = useMemo(
    () =>
      variants.filter((v) => {
        const total = v.stockLevels.reduce((s, l) => s + l.quantity, 0);
        return total <= v.lowStockThreshold;
      }),
    [variants]
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-brand-900">Inventario</h1>
        <p className="text-sm text-slate-500">
          Entradas, salidas y ajustes de stock, con historial completo de movimientos.
        </p>
      </div>

      {lowStock.length > 0 && (
        <Card className="mb-6 border-amber-200 bg-amber-50">
          <CardContent className="py-4">
            <p className="mb-2 text-sm font-semibold text-amber-800">
              {lowStock.length} {lowStock.length === 1 ? "producto" : "productos"} con stock bajo
            </p>
            <div className="flex flex-wrap gap-2">
              {lowStock.map((v) => (
                <Badge key={v.id} tone="warn">
                  {v.product.name} ({v.sku})
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {canManage && (
        <div className="mb-6">
          <MovementForm
            variants={variants}
            warehouses={warehouses}
            onSaved={() => router.refresh()}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Historial de movimientos</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {movements.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">
              Todavía no hay movimientos registrados.
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Fecha</Th>
                  <Th>Producto</Th>
                  <Th>Bodega</Th>
                  <Th>Tipo</Th>
                  <Th>Cantidad</Th>
                  <Th>Motivo</Th>
                  <Th>Usuario</Th>
                  {canEditMovements && <Th>Acciones</Th>}
                </Tr>
              </Thead>
              <Tbody>
                {movements.map((m) => (
                  <MovementRow
                    key={m.id}
                    movement={m}
                    canEditMovements={canEditMovements}
                    onChanged={() => router.refresh()}
                  />
                ))}
              </Tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MovementRow({
  movement,
  canEditMovements,
  onChanged,
}: {
  movement: Movement;
  canEditMovements: boolean;
  onChanged: () => void;
}) {
  const m = movement;
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<Movement["type"]>(m.type);
  // La cantidad se muestra siempre en positivo en el formulario de edición
  // (igual que al crear un movimiento); el signo lo decide el tipo.
  const [quantity, setQuantity] = useState(String(Math.abs(m.quantity)));
  const [reason, setReason] = useState(m.reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isAuto = Boolean(m.saleId || m.purchaseId);

  function startEdit() {
    setType(m.type);
    setQuantity(String(Math.abs(m.quantity)));
    setReason(m.reason ?? "");
    setError(null);
    setEditing(true);
  }

  async function saveEdit() {
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/stock-movements/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, quantity: Number(quantity) || 0, reason }),
    });
    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo guardar el cambio.");
      return;
    }

    setEditing(false);
    onChanged();
  }

  async function handleDelete() {
    if (!window.confirm("¿Eliminar este movimiento? Esto revierte su efecto sobre el stock.")) {
      return;
    }
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/stock-movements/${m.id}`, { method: "DELETE" });
    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo eliminar el movimiento.");
      return;
    }

    onChanged();
  }

  async function handleDuplicate() {
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/stock-movements/${m.id}/duplicate`, { method: "POST" });
    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo duplicar el movimiento.");
      return;
    }

    onChanged();
  }

  if (editing) {
    return (
      <Tr>
        <Td className="whitespace-nowrap text-xs text-slate-500">{formatDate(m.createdAt)}</Td>
        <Td>
          {m.variant.product.name}{" "}
          <span className="font-mono text-xs text-slate-400">({m.variant.sku})</span>
        </Td>
        <Td>{m.warehouse.name}</Td>
        <Td>
          <Select value={type} onChange={(e) => setType(e.target.value as Movement["type"])}>
            <option value="ENTRADA">Entrada</option>
            <option value="SALIDA">Salida</option>
            <option value="AJUSTE">Ajuste (+/-)</option>
          </Select>
        </Td>
        <Td>
          <Input
            type="number"
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-24"
          />
        </Td>
        <Td>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Opcional" />
        </Td>
        <Td className="text-slate-500">{m.user.name || "—"}</Td>
        <Td>
          <div className="flex flex-col gap-1">
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={saveEdit}
                disabled={loading}
                className="px-2.5 py-1 text-xs"
              >
                Guardar
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditing(false)}
                disabled={loading}
                className="px-2.5 py-1 text-xs"
              >
                Cancelar
              </Button>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
        </Td>
      </Tr>
    );
  }

  return (
    <Tr>
      <Td className="whitespace-nowrap text-xs text-slate-500">{formatDate(m.createdAt)}</Td>
      <Td>
        {m.variant.product.name}{" "}
        <span className="font-mono text-xs text-slate-400">({m.variant.sku})</span>
      </Td>
      <Td>{m.warehouse.name}</Td>
      <Td>
        <Badge tone={typeTone[m.type]}>{typeLabels[m.type]}</Badge>
      </Td>
      <Td className={m.quantity < 0 ? "text-red-700" : "text-emerald-700"}>
        {m.quantity > 0 ? "+" : ""}
        {formatNumber(m.quantity)}
      </Td>
      <Td className="text-slate-500">{m.reason || "—"}</Td>
      <Td className="text-slate-500">{m.user.name || "—"}</Td>
      {canEditMovements && (
        <Td>
          {isAuto ? (
            <span className="text-xs text-slate-400" title="Generado por una venta o compra">
              Automático
            </span>
          ) : (
            <div className="flex flex-col items-end gap-1">
              <DropdownMenu trigger={<DotsIcon />} label="Acciones del movimiento">
                <DropdownMenuItem onClick={startEdit} disabled={loading}>
                  Editar
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDuplicate} disabled={loading}>
                  Duplicar
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDelete} disabled={loading} danger>
                  Eliminar
                </DropdownMenuItem>
              </DropdownMenu>
              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>
          )}
        </Td>
      )}
    </Tr>
  );
}

function MovementForm({
  variants,
  warehouses,
  onSaved,
}: {
  variants: Variant[];
  warehouses: Warehouse[];
  onSaved: () => void;
}) {
  const defaultWarehouse = warehouses.find((w) => w.isDefault) ?? warehouses[0];

  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const [warehouseId, setWarehouseId] = useState(defaultWarehouse?.id ?? "");
  const [type, setType] = useState<Movement["type"]>("ENTRADA");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!variantId || !warehouseId) {
      setError("Selecciona un producto y una bodega.");
      return;
    }

    setLoading(true);
    const res = await fetch("/api/stock-movements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variantId,
        warehouseId,
        type,
        quantity: Number(quantity) || 0,
        reason,
      }),
    });
    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo registrar el movimiento.");
      return;
    }

    setQuantity("1");
    setReason("");
    onSaved();
  }

  if (variants.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-slate-500">
          Todavía no hay productos activos. Crea uno en la sección de Productos antes de
          registrar movimientos.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Registrar movimiento</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid grid-cols-6 gap-3 items-end">
          <div className="col-span-2">
            <Label htmlFor="mv-variant">Producto (SKU)</Label>
            <Select
              id="mv-variant"
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
            >
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.product.name} — {v.sku}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="mv-warehouse">Bodega</Label>
            <Select
              id="mv-warehouse"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="mv-type">Tipo</Label>
            <Select
              id="mv-type"
              value={type}
              onChange={(e) => setType(e.target.value as Movement["type"])}
            >
              <option value="ENTRADA">Entrada</option>
              <option value="SALIDA">Salida</option>
              <option value="AJUSTE">Ajuste (+/-)</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="mv-quantity">Cantidad</Label>
            <Input
              id="mv-quantity"
              type="number"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="mv-reason">Motivo</Label>
            <Input
              id="mv-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Opcional"
            />
          </div>
          <div className="col-span-6">
            {error && (
              <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando…" : "Registrar movimiento"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
