"use client";

import { ChangeEvent, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatCurrency, formatNumber } from "@/lib/utils";

interface PreviewRow {
  rowNumber: number;
  sku: string;
  name: string;
  qty: unknown;
  warehouseName: string;
  price: unknown;
  action: "crear" | "actualizar";
  isNewWarehouse: boolean;
  errors: string[];
}

interface PreviewSummary {
  totalRows: number;
  valid: number;
  invalid: number;
  toCreate: number;
  toUpdate: number;
  newWarehouses: string[];
}

interface CommitResult {
  created: number;
  updated: number;
  stockAdjustments: number;
  warehousesCreated: string[];
}

type Step = "upload" | "preview" | "done";

export function ProductImport() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [summary, setSummary] = useState<PreviewSummary | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setLoading(true);
    setFileName(file.name);

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/products/import/preview", {
      method: "POST",
      body: formData,
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo leer el archivo.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const data = await res.json();
    setRows(data.rows);
    setSummary(data.summary);
    setStep("preview");
  }

  async function handleConfirm() {
    setError(null);
    setLoading(true);

    const validRows = rows.filter((r) => r.errors.length === 0);
    const res = await fetch("/api/products/import/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: validRows }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo completar la importación.");
      return;
    }

    const data = await res.json();
    setResult(data);
    setStep("done");
  }

  function reset() {
    setStep("upload");
    setFileName(null);
    setRows([]);
    setSummary(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <Link href="/products" className="text-xs font-medium text-slate-400 hover:text-brand-700">
          ← Volver a productos
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-brand-900">Importar productos desde Excel</h1>
        <p className="text-sm text-slate-500">
          El archivo debe tener columnas de SKU, Nombre, Cantidad, Bodega y Valor. Un SKU que ya
          existe se actualiza (precio y stock); uno nuevo crea el producto.
        </p>
      </div>

      {step === "upload" && (
        <Card>
          <CardHeader>
            <CardTitle>Subir archivo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              disabled={loading}
              className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-md file:border-0 file:bg-brand-700 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-900"
            />
            {loading && <p className="text-sm text-slate-500">Leyendo {fileName}…</p>}
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </CardContent>
        </Card>
      )}

      {step === "preview" && summary && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Resumen — {fileName}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <SummaryStat label="Filas en el archivo" value={summary.totalRows} />
                <SummaryStat label="Productos nuevos" value={summary.toCreate} tone="good" />
                <SummaryStat label="Productos a actualizar" value={summary.toUpdate} />
                <SummaryStat label="Filas con error" value={summary.invalid} tone={summary.invalid > 0 ? "critical" : undefined} />
              </div>
              {summary.newWarehouses.length > 0 && (
                <p className="mt-4 text-xs text-slate-500">
                  Se crearán estas bodegas nuevas: {summary.newWarehouses.join(", ")}.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Detalle por fila</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[28rem] overflow-y-auto">
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Fila</Th>
                      <Th>SKU</Th>
                      <Th>Nombre</Th>
                      <Th>Bodega</Th>
                      <Th>Cantidad</Th>
                      <Th>Valor</Th>
                      <Th>Estado</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {rows.map((row) => (
                      <Tr key={row.rowNumber}>
                        <Td className="text-xs text-slate-400">{row.rowNumber}</Td>
                        <Td className="font-mono text-xs">{row.sku || "—"}</Td>
                        <Td>{row.name || "—"}</Td>
                        <Td>
                          {row.warehouseName || "—"}
                          {row.isNewWarehouse && row.errors.length === 0 && (
                            <Badge tone="neutral" className="ml-2">
                              nueva
                            </Badge>
                          )}
                        </Td>
                        <Td>{typeof row.qty === "number" ? formatNumber(row.qty) : String(row.qty ?? "—")}</Td>
                        <Td>{typeof row.price === "number" ? formatCurrency(row.price) : String(row.price ?? "—")}</Td>
                        <Td>
                          {row.errors.length > 0 ? (
                            <div>
                              <Badge tone="critical">Error</Badge>
                              <p className="mt-1 text-xs text-red-600">{row.errors.join("; ")}</p>
                            </div>
                          ) : row.action === "crear" ? (
                            <Badge tone="good">Crear</Badge>
                          ) : (
                            <Badge tone="neutral">Actualizar</Badge>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={reset} disabled={loading}>
              Elegir otro archivo
            </Button>
            <Button type="button" onClick={handleConfirm} disabled={loading || summary.valid === 0}>
              {loading
                ? "Importando…"
                : `Confirmar importación (${summary.valid} ${summary.valid === 1 ? "fila" : "filas"})`}
            </Button>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <Card>
          <CardHeader>
            <CardTitle>Importación completa</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <SummaryStat label="Productos creados" value={result.created} tone="good" />
              <SummaryStat label="Productos actualizados" value={result.updated} />
              <SummaryStat label="Ajustes de stock" value={result.stockAdjustments} />
              <SummaryStat label="Bodegas nuevas" value={result.warehousesCreated.length} />
            </div>
            {result.warehousesCreated.length > 0 && (
              <p className="text-xs text-slate-500">
                Bodegas creadas: {result.warehousesCreated.join(", ")}.
              </p>
            )}
            <div className="flex gap-3 pt-2">
              <Link href="/products">
                <Button>Ver productos</Button>
              </Link>
              <Button type="button" variant="secondary" onClick={reset}>
                Importar otro archivo
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "critical";
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${
          tone === "good" ? "text-emerald-700" : tone === "critical" ? "text-red-700" : "text-brand-900"
        }`}
      >
        {formatNumber(value)}
      </p>
    </div>
  );
}
