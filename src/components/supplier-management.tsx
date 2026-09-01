"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";

interface SupplierRow {
  id: string;
  name: string;
  taxId: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  _count: { purchases: number };
}

export function SupplierManagement({ suppliers }: { suppliers: SupplierRow[] }) {
  const router = useRouter();

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-brand-900">Proveedores</h1>
          <p className="text-sm text-slate-500">
            Ficha de cada proveedor, con acceso directo a su historial de compras.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Todos los proveedores</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {suppliers.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">
              Todavía no hay proveedores cargados. Crea el primero con el formulario de abajo.
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Nombre</Th>
                  <Th>RUT / ID</Th>
                  <Th>Contacto</Th>
                  <Th>Compras</Th>
                  <Th>Estado</Th>
                </Tr>
              </Thead>
              <Tbody>
                {suppliers.map((supplier) => (
                  <Tr key={supplier.id}>
                    <Td>
                      <Link
                        href={`/suppliers/${supplier.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {supplier.name}
                      </Link>
                    </Td>
                    <Td className="text-slate-500">{supplier.taxId || "—"}</Td>
                    <Td className="text-slate-500">
                      {supplier.phone || supplier.email || "—"}
                    </Td>
                    <Td>{supplier._count.purchases}</Td>
                    <Td>
                      <Badge tone={supplier.active ? "good" : "neutral"}>
                        {supplier.active ? "Activo" : "Inactivo"}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="mt-6">
        <AddSupplierForm onSaved={() => router.refresh()} />
      </div>
    </div>
  );
}

function AddSupplierForm({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, taxId, phone, email, address }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo crear el proveedor.");
      return;
    }

    setName("");
    setTaxId("");
    setPhone("");
    setEmail("");
    setAddress("");
    setOpen(false);
    onSaved();
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        + Agregar proveedor
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nuevo proveedor</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="s-name">Nombre</Label>
              <Input id="s-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="s-taxid">RUT / identificación</Label>
              <Input
                id="s-taxid"
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                placeholder="Opcional"
              />
            </div>
            <div>
              <Label htmlFor="s-phone">Teléfono</Label>
              <Input
                id="s-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Opcional"
              />
            </div>
            <div>
              <Label htmlFor="s-email">Correo</Label>
              <Input
                id="s-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Opcional"
              />
            </div>
            <div className="col-span-2">
              <Label htmlFor="s-address">Dirección</Label>
              <Input
                id="s-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Opcional"
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
              {loading ? "Creando…" : "Crear proveedor"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
