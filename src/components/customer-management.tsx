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
import { Select } from "@/components/ui/select";
import { formatDate } from "@/lib/utils";
import {
  CUSTOMER_STAGES,
  LEAD_SOURCES,
  customerStageLabels,
  customerStageTone,
  leadSourceLabels,
  type CustomerStage,
  type LeadSource,
} from "@/lib/customers";

interface CustomerRow {
  id: string;
  name: string;
  taxId: string | null;
  phone: string | null;
  email: string | null;
  contactName: string | null;
  stage: CustomerStage;
  source: LeadSource | null;
  nextContactAt: string | null;
  active: boolean;
  _count: { sales: number; quotes: number };
}

export function CustomerManagement({ customers }: { customers: CustomerRow[] }) {
  const router = useRouter();
  const [filtro, setFiltro] = useState<CustomerStage | "TODOS">("TODOS");
  const visibles = filtro === "TODOS" ? customers : customers.filter((c) => c.stage === filtro);
  const hoy = new Date();
  const conteo = (s: CustomerStage) => customers.filter((c) => c.stage === s).length;

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-brand-900">Clientes</h1>
          <p className="text-sm text-slate-500">
            Interesados y clientes, con su etapa, su próximo contacto y su historial.
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFiltro("TODOS")}
          className={`rounded-full px-3 py-1 text-xs font-medium ${filtro === "TODOS" ? "bg-brand-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
        >
          Todos ({customers.length})
        </button>
        {CUSTOMER_STAGES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFiltro(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${filtro === s ? "bg-brand-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {customerStageLabels[s]} ({conteo(s)})
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Todos los clientes</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {visibles.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">
              {customers.length === 0
                ? "Todavía no hay interesados ni clientes. Registra el primero con el formulario de abajo."
                : "No hay nadie en esta etapa."}
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Negocio</Th>
                  <Th>Etapa</Th>
                  <Th>Origen</Th>
                  <Th>Contacto</Th>
                  <Th>Próximo contacto</Th>
                  <Th>Cotiz.</Th>
                  <Th>Ventas</Th>
                </Tr>
              </Thead>
              <Tbody>
                {visibles.map((customer) => {
                  const atrasado =
                    customer.nextContactAt !== null &&
                    new Date(customer.nextContactAt).getTime() < hoy.getTime() &&
                    customer.stage !== "CLIENTE" &&
                    customer.stage !== "PERDIDO";
                  return (
                    <Tr key={customer.id}>
                      <Td>
                        <Link
                          href={`/customers/${customer.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {customer.name}
                        </Link>
                        {customer.contactName && (
                          <p className="text-xs text-slate-400">{customer.contactName}</p>
                        )}
                        {!customer.active && <Badge tone="neutral" className="ml-2">Inactivo</Badge>}
                      </Td>
                      <Td>
                        <Badge tone={customerStageTone[customer.stage]}>
                          {customerStageLabels[customer.stage]}
                        </Badge>
                      </Td>
                      <Td className="text-slate-500">
                        {customer.source ? leadSourceLabels[customer.source] : "—"}
                      </Td>
                      <Td className="text-slate-500">{customer.phone || customer.email || "—"}</Td>
                      <Td className={atrasado ? "font-medium text-red-700" : "text-slate-500"}>
                        {customer.nextContactAt ? formatDate(customer.nextContactAt) : "—"}
                      </Td>
                      <Td>{customer._count.quotes}</Td>
                      <Td>{customer._count.sales}</Td>
                    </Tr>
                  );
                })}
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
  const [contactName, setContactName] = useState("");
  const [source, setSource] = useState<LeadSource | "">("WHATSAPP");
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
      body: JSON.stringify({ name, contactName, source, taxId, phone, email, address }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo crear el cliente.");
      return;
    }

    setName("");
    setContactName("");
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
        + Registrar interesado
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nuevo interesado</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="c-name">Negocio</Label>
              <Input id="c-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="c-contact">Persona de contacto</Label>
              <Input id="c-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Opcional" />
            </div>
            <div>
              <Label htmlFor="c-source">Por dónde llegó</Label>
              <Select id="c-source" value={source} onChange={(e) => setSource(e.target.value as LeadSource | "")}>
                <option value="">Sin especificar</option>
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {leadSourceLabels[s]}
                  </option>
                ))}
              </Select>
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
            <div className="md:col-span-2">
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
              {loading ? "Guardando…" : "Registrar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
