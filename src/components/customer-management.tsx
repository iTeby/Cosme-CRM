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

interface CustomerRow {
  id: string;
  name: string;
  taxId: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  _count: { sales: number };
}

export function CustomerManagement({ customers }: { customers: CustomerRow[] }) {
  const router = useRouter();

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-brand-900">Clientes</h1>
          <p className="text-sm text-slate-500">
            Ficha de cada cliente, con acceso directo a su historial de compras.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Todos los clientes</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {customers.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">
              Todavía no hay clientes cargados. Crea el primero con el formulario de abajo.
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
                {customers.map((customer) => (
                  <Tr key={customer.id}>
                    <Td>
                      <Link
                        href={`/customers/${customer.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {customer.name}
                      </Link>
                    </Td>
                    <Td className="text-slate-500">{customer.taxId || "—"}</Td>
                    <Td className="text-slate-500">
                      {customer.phone || customer.email || "—"}
                    </Td>
                    <Td>{customer._count.sales}</Td>
                    <Td>
                      <Badge tone={customer.active ? "good" : "neutral"}>
                        {customer.active ? "Activo" : "Inactivo"}
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
        <AddCustomerForm onSaved={() => router.refresh()} />
      </div>
    </div>
  );
}

function AddCustomerForm({ onSaved }: { onSaved: () => void }) {
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

    const res = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, taxId, phone, email, address }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo crear el cliente.");
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
        + Agregar cliente
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nuevo cliente</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="c-name">Nombre</Label>
              <Input id="c-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="c-taxid">RUT / identificación</Label>
              <Input
                id="c-taxid"
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                placeholder="Opcional"
              />
            </div>
            <div>
              <Label htmlFor="c-phone">Teléfono</Label>
              <Input
                id="c-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Opcional"
              />
            </div>
            <div>
              <Label htmlFor="c-email">Correo</Label>
              <Input
                id="c-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Opcional"
              />
            </div>
            <div className="col-span-2">
              <Label htmlFor="c-address">Dirección</Label>
              <Input
                id="c-address"
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
              {loading ? "Creando…" : "Crear cliente"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
