"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";
import { dteStatusLabels, dteStatusTone, dteTypeLabels } from "@/lib/dte/issue";

export interface DteRow {
  id: string;
  type: string;
  environment: string;
  provider: string;
  status: string;
  folio: number | null;
  netAmount: string;
  taxAmount: string;
  totalAmount: string;
  pdfUrl: string | null;
  errorMessage: string | null;
  issuedAt: string | null;
  createdAt: string;
}

export function DteCard({
  saleId,
  dtes,
  environment,
  provider,
  clienteTieneRut,
  canManage,
  ventaAnulada,
}: {
  saleId: string;
  dtes: DteRow[];
  environment: string;
  provider: string;
  clienteTieneRut: boolean;
  canManage: boolean;
  ventaAnulada: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [aNombreDelCliente, setANombreDelCliente] = useState(false);
  const [confirmacion, setConfirmacion] = useState("");

  const vigente = dtes.find((d) => d.status === "ACEPTADO" || d.status === "ENVIADO") ?? null;
  const ultimo = dtes[0] ?? null;
  const simulado = provider === "simulado";
  const certificacion = environment === "CERTIFICACION";
  const sinConfirmar = dtes.find((d) => d.status === "INDETERMINADO") ?? null;

  // En producción cada clic gasta un folio real que solo se devuelve con nota
  // de crédito. Un badge rojo no frena a nadie a las 20:45 con cola; escribir
  // la palabra sí obliga a mirar la pantalla una vez.
  const PALABRA = "EMITIR";
  const requiereConfirmacion = !certificacion && !simulado;
  const confirmado = !requiereConfirmacion || confirmacion.trim().toUpperCase() === PALABRA;

  async function emitir() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/sales/${saleId}/dte`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: "BOLETA", identificarReceptor: aNombreDelCliente }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "No se pudo emitir el documento.");
        router.refresh();
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor. Revisa la conexión y vuelve a intentar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>
          <span className="flex flex-wrap items-center gap-3">
            Boleta electrónica
            {certificacion && <Badge tone="warn">Certificación — no es un documento real</Badge>}
            {!certificacion && <Badge tone="critical">Producción — folios reales</Badge>}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {simulado && (
          <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            No hay credenciales del proveedor configuradas, así que no se llama a nadie: el
            documento se registra localmente para poder ver la pantalla completa, con un folio
            inventado. Nada de esto llega al SII.
          </p>
        )}

        {vigente ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Documento</p>
                <p className="text-sm text-slate-700">
                  {dteTypeLabels[vigente.type] ?? vigente.type}
                  {vigente.folio ? ` N° ${vigente.folio}` : ""}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Estado</p>
                <Badge tone={dteStatusTone[vigente.status] ?? "neutral"}>
                  {dteStatusLabels[vigente.status] ?? vigente.status}
                </Badge>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Neto</p>
                <p className="text-sm text-slate-700">{formatCurrency(vigente.netAmount)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">IVA</p>
                <p className="text-sm text-slate-700">{formatCurrency(vigente.taxAmount)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Total</p>
                <p className="text-base font-semibold text-brand-900">
                  {formatCurrency(vigente.totalAmount)}
                </p>
              </div>
            </div>

            {vigente.issuedAt && (
              <p className="text-xs text-slate-500">Emitida el {formatDate(vigente.issuedAt)}</p>
            )}

            {vigente.status === "ENVIADO" && (
              <p className="text-sm text-slate-500">
                El proveedor la recibió. El SII todavía no confirma; hasta entonces no se marca
                como aceptada.
              </p>
            )}

            {vigente.pdfUrl && (
              <a
                href={vigente.pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-sm font-medium text-brand-700 hover:underline"
              >
                Ver el PDF
              </a>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {sinConfirmar && (
              <div className="rounded-md bg-amber-50 px-3 py-3 text-sm text-amber-900">
                <p className="font-medium">El intento anterior quedó sin confirmar</p>
                <p className="mt-1">
                  {sinConfirmar.errorMessage ??
                    "No se pudo saber si el documento llegó a emitirse."}
                </p>
                <p className="mt-2">
                  Puede que la boleta exista igual. Revísalo en el portal del proveedor antes de
                  hacer nada: volver a emitir gastaría un segundo folio y habría que anular uno de
                  los dos con nota de crédito.
                </p>
              </div>
            )}

            {ultimo && (ultimo.status === "ERROR" || ultimo.status === "RECHAZADO") && (
              <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                <p className="font-medium">
                  {dteStatusLabels[ultimo.status] ?? ultimo.status} el {formatDate(ultimo.createdAt)}
                </p>
                {ultimo.errorMessage && <p className="mt-1">{ultimo.errorMessage}</p>}
              </div>
            )}

            {ventaAnulada ? (
              <p className="text-sm text-slate-500">
                Esta venta está anulada: no se emite documento.
              </p>
            ) : !canManage ? (
              <p className="text-sm text-slate-500">
                No tienes permiso para emitir documentos tributarios.
              </p>
            ) : (
              <>
                <p className="text-sm text-slate-500">
                  Todavía no se ha emitido la boleta de esta venta.
                </p>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={aNombreDelCliente}
                    onChange={(e) => setANombreDelCliente(e.target.checked)}
                    disabled={!clienteTieneRut}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  A nombre del cliente
                  {!clienteTieneRut && (
                    <span className="text-xs text-slate-400">
                      (el cliente no tiene RUT registrado)
                    </span>
                  )}
                </label>

                {requiereConfirmacion && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-3">
                    <p className="text-sm text-red-800">
                      Esto emite una boleta <strong>real</strong> ante el SII con un folio que no
                      vuelve. Escribe <strong>{PALABRA}</strong> para confirmar.
                    </p>
                    <input
                      value={confirmacion}
                      onChange={(e) => setConfirmacion(e.target.value)}
                      className="mt-2 w-40 rounded-md border border-red-300 px-2 py-1 text-sm"
                      placeholder={PALABRA}
                      aria-label={`Escribe ${PALABRA} para confirmar`}
                    />
                  </div>
                )}

                {error && (
                  <p className="text-sm text-red-600" role="alert">
                    {error}
                  </p>
                )}

                <Button onClick={emitir} disabled={loading || !confirmado || Boolean(sinConfirmar)}>
                  {loading ? "Emitiendo…" : "Emitir boleta"}
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
