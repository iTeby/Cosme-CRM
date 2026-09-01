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
import { purchaseStatusLabels, purchaseStatusTone, type PurchaseStatus } from "@/lib/purchases";

interface PurchaseItemRow {
  id: string;
  quantity: number;
}

interface PurchaseRow {
  id: string;
  number: number;
  status: PurchaseStatus;
  totalAmount: string;
  createdAt: string;
  items: PurchaseItemRow[];
}

interface SupplierData {
  id: string;
  name: string;
  taxId: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  purchases: PurchaseRow[];
}

export function SupplierDetail({
  supplier,
  canManage,
}: {
  supplier: SupplierData;
  canManage: boolean;
}) {
  const router = useRouter();

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/suppliers" className="text-xs font-medium text-slate-400 hover:text-brand-700">
            ← Volver a proveedores
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-brand-900">{supplier.name}</h1>
        </div>
        <Badge tone={supplier.active ? "good" : "neutral"}>
          {supplier.active ? "Activo" : "Inactivo"}
        </Badge>
      </div>

      <SupplierFields supplier={supplier} canManage={canManage} onSaved={() => router.refresh()} />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Historial de compras</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {supplier.purchases.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">
              Este proveedor todavía no tiene compras registradas.
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Compra</Th>
                  <Th>Fecha</Th>
                  <Th>Líneas</Th>
                  <Th>Total</Th>
                  <Th>Estado</Th>
                </Tr>
              </Thead>
              <Tbody>
                {supplier.purchases.map((purchase) => (
                  <Tr key={purchase.id}>
                    <Td>
                      <Link
                        href={`/purchases/${purchase.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        #{purchase.number}
                      </Link>
                    </Td>
                    <Td className="text-xs text-slate-500">{formatDate(purchase.createdAt)}</Td>
                    <Td>{purchase.items.length}</Td>
                    <Td>{formatCurrency(purchase.totalAmount)}</Td>
                    <Td>
                      <Badge tone={purchaseStatusTone[purchase.status]}>
                        {purchaseStatusLabels[purchase.status]}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SupplierFields({
  supplier,
  canManage,
  onSaved,
}: {
  supplier: SupplierData;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(supplier.name);
  const [taxId, setTaxId] = useState(supplier.taxId ?? "");
  const [phone, setPhone] = useState(supplier.phone ?? "");
  const [email, setEmail] = useState(supplier.email ?? "");
  const [address, setAddress] = useState(supplier.address ?? "");
  const [notes, setNotes] = useState(supplier.notes ?? "");
  const [active, setActive] = useState(supplier.active);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/suppliers/${supplier.id}`, {
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
              <dd className="text-slate-700">{supplier.taxId || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Teléfono</dt>
              <dd className="text-slate-700">{supplier.phone || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Correo</dt>
              <dd className="text-slate-700">{supplier.email || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Dirección</dt>
              <dd className="text-slate-700">{supplier.address || "—"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs uppercase tracking-wide text-slate-400">Notas</dt>
              <dd className="text-slate-700">{supplier.notes || "—"}</dd>
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
            <Label htmlFor="edit-s-name">Nombre</Label>
            <Input id="edit-s-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="edit-s-taxid">RUT / identificación</Label>
            <Input id="edit-s-taxid" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="edit-s-phone">Teléfono</Label>
            <Input id="edit-s-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="edit-s-email">Correo</Label>
            <Input id="edit-s-email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="edit-s-address">Dirección</Label>
            <Input id="edit-s-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="edit-s-notes">Notas</Label>
            <Input id="edit-s-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex items-end gap-2 pb-1">
            <input
              id="edit-s-active"
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <Label htmlFor="edit-s-active" className="mb-0">
              Proveedor activo
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
