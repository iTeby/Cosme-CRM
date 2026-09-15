"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  invoiceDisplayState,
  invoiceStateLabels,
  invoiceStateTone,
  taxFor,
} from "@/lib/invoices";

export interface InvoiceRow {
  id: string;
  number: string;
  issuedAt: string;
  netAmount: string;
  taxAmount: string;
  totalAmount: string;
  driveUrl: string | null;
  status: "EMITIDA" | "ANULADA";
  notes: string | null;
}

// Las facturas se emiten en el SII. Acá se registran: folio, fecha, neto (el
// IVA se calcula), y el enlace al PDF guardado en Google Drive.
export function InvoiceCard({
  saleId,
  saleTotal,
  salePaid,
  invoices,
  canManage,
}: {
  saleId: string;
  saleTotal: string;
  salePaid: string;
  invoices: InvoiceRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState("");
  const [issuedAt, setIssuedAt] = useState(new Date().toISOString().slice(0, 10));
  const [netAmount, setNetAmount] = useState("");
  const [driveUrl, setDriveUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const neto = Number(netAmount) || 0;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saleId, number, issuedAt, netAmount: neto, driveUrl }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo registrar la factura.");
      return;
    }
    setNumber("");
    setNetAmount("");
    setDriveUrl("");
    setOpen(false);
    router.refresh();
  }

  async function anular(id: string) {
    if (!window.confirm("¿Marcar esta factura como anulada? No se borra: queda en el historial.")) return;
    const res = await fetch(`/api/invoices/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ANULADA" }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo anular.");
      return;
    }
    router.refresh();
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Facturas</CardTitle>
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <p className="mb-4 text-sm text-slate-500">
            Esta venta no tiene facturas registradas. La factura se emite en el SII y acá se anota
            el folio y el enlace al PDF.
          </p>
        ) : (
          <div className="mb-4 overflow-hidden rounded-lg border border-slate-200">
            <Table>
              <Thead>
                <Tr>
                  <Th>Folio</Th>
                  <Th>Fecha</Th>
                  <Th>Neto</Th>
                  <Th>IVA</Th>
                  <Th>Total</Th>
                  <Th>PDF</Th>
                  <Th>Estado</Th>
                  {canManage && <Th />}
                </Tr>
              </Thead>
              <Tbody>
                {invoices.map((f) => {
                  const estado = invoiceDisplayState(f.status, saleTotal, salePaid);
                  return (
                    <Tr key={f.id}>
                      <Td className="font-medium">{f.number}</Td>
                      <Td className="text-xs text-slate-500">{formatDate(f.issuedAt)}</Td>
                      <Td>{formatCurrency(f.netAmount)}</Td>
                      <Td>{formatCurrency(f.taxAmount)}</Td>
                      <Td className="font-medium">{formatCurrency(f.totalAmount)}</Td>
                      <Td>
                        {f.driveUrl ? (
                          <a
                            href={f.driveUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-brand-700 hover:underline"
                          >
                            Abrir
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={invoiceStateTone[estado]}>{invoiceStateLabels[estado]}</Badge>
                      </Td>
                      {canManage && (
                        <Td>
                          {f.status !== "ANULADA" && (
                            <Button type="button" variant="ghost" onClick={() => anular(f.id)}>
                              Anular
                            </Button>
                          )}
                        </Td>
                      )}
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </div>
        )}

        {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {canManage && !open && (
          <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
            + Registrar factura
          </Button>
        )}

        {canManage && open && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="inv-number">Folio SII</Label>
                <Input id="inv-number" required value={number} onChange={(e) => setNumber(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="inv-date">Fecha de emisión</Label>
                <Input id="inv-date" type="date" required value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="inv-net">Monto neto</Label>
                <Input
                  id="inv-net"
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={netAmount}
                  onChange={(e) => setNetAmount(e.target.value)}
                />
                <p className="mt-1 text-xs text-slate-400">
                  IVA {formatCurrency(taxFor(neto))} · Total {formatCurrency(neto + taxFor(neto))}
                </p>
              </div>
              <div className="sm:col-span-3">
                <Label htmlFor="inv-url">Enlace al PDF en Google Drive</Label>
                <Input
                  id="inv-url"
                  type="url"
                  placeholder="https://drive.google.com/…"
                  value={driveUrl}
                  onChange={(e) => setDriveUrl(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Guardando…" : "Guardar factura"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
