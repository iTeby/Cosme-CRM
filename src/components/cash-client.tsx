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
import { round2, toNumber } from "@/lib/decimal";
import { differenceLabel, differenceTone, type ShiftTotals } from "@/lib/cash";
import { paymentMethodLabels, type PaymentMethod } from "@/lib/payments";

interface ShiftRow {
  id: string;
  number: number;
  openingAmount: string;
  expectedAmount: string | null;
  countedAmount: string | null;
  difference: string | null;
  openingNotes: string | null;
  closingNotes: string | null;
  openedAt: string;
  closedAt: string | null;
  openedBy: { name: string | null };
  closedBy: { name: string | null } | null;
}

/** Lo que devuelve el cierre: el arqueo tal como quedó congelado. */
interface ArqueoCerrado {
  number: number;
  expectedAmount: string | null;
  countedAmount: string | null;
  difference: string | null;
}

interface OpenShift {
  id: string;
  number: number;
  openingAmount: string;
  openingNotes: string | null;
  openedAt: string;
  cashOps: number;
}

export function CashClient({
  shift,
  expected,
  totals,
  history,
  warehouseName,
  canManage,
}: {
  shift: OpenShift | null;
  expected: number;
  totals: ShiftTotals | null;
  history: ShiftRow[];
  warehouseName: string | null;
  canManage: boolean;
}) {
  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-brand-900">Caja</h1>
        <p className="text-sm text-slate-500">
          El turno es el período entre que se abre el cajón con un fondo y se cierra contando lo
          que hay. Sirve para una sola pregunta: ¿la plata que hay es la que debería haber?
          {warehouseName && ` Caja de ${warehouseName}.`}
        </p>
      </div>

      {shift ? (
        <OpenShiftCard
          shift={shift}
          expected={expected}
          totals={totals}
          canManage={canManage}
        />
      ) : (
        <ClosedCard canManage={canManage} />
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Turnos cerrados</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {history.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">
              Todavía no se ha cerrado ningún turno.
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Turno</Th>
                  <Th>Cerrado</Th>
                  <Th>Fondo</Th>
                  <Th>Esperado</Th>
                  <Th>Contado</Th>
                  <Th>Diferencia</Th>
                  <Th>Quién</Th>
                </Tr>
              </Thead>
              <Tbody>
                {history.map((turno) => (
                  <Tr key={turno.id}>
                    <Td className="font-medium">#{turno.number}</Td>
                    <Td className="whitespace-nowrap text-xs text-slate-500">
                      {turno.closedAt ? formatDate(turno.closedAt) : "—"}
                    </Td>
                    <Td>{formatCurrency(turno.openingAmount)}</Td>
                    <Td>{turno.expectedAmount ? formatCurrency(turno.expectedAmount) : "—"}</Td>
                    <Td>{turno.countedAmount ? formatCurrency(turno.countedAmount) : "—"}</Td>
                    <Td>
                      {turno.difference === null ? (
                        "—"
                      ) : (
                        <span className="flex items-center gap-2">
                          <Badge tone={differenceTone(turno.difference)}>
                            {differenceLabel(turno.difference)}
                          </Badge>
                          {round2(turno.difference) !== 0 && (
                            <span className="text-xs text-slate-500">
                              {formatCurrency(Math.abs(toNumber(turno.difference)))}
                            </span>
                          )}
                        </span>
                      )}
                    </Td>
                    <Td className="text-xs text-slate-500">{turno.closedBy?.name || "—"}</Td>
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

function ClosedCard({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const [openingAmount, setOpeningAmount] = useState("0");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function abrir(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/cash-shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openingAmount: toNumber(openingAmount), notes }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "No se pudo abrir el turno.");
        return;
      }
      setNotes("");
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor. Revisa la conexión y vuelve a intentar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Caja cerrada</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-slate-500">
          No hay ningún turno abierto. Mientras la caja esté cerrada se pueden registrar ventas y
          fiados, pero no cobrar en efectivo: esa plata no tendría dónde cuadrarse después.
        </p>

        {!canManage ? (
          <p className="text-sm text-slate-500">No tienes permiso para abrir la caja.</p>
        ) : (
          <form onSubmit={abrir} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_1fr]">
              <div>
                <Label htmlFor="turno-fondo">Fondo inicial</Label>
                <Input
                  id="turno-fondo"
                  type="number"
                  min="0"
                  step="0.01"
                  value={openingAmount}
                  onChange={(e) => {
                    setError(null);
                    setOpeningAmount(e.target.value);
                  }}
                />
              </div>
              <div>
                <Label htmlFor="turno-nota">Nota</Label>
                <Input
                  id="turno-nota"
                  maxLength={300}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Opcional"
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" disabled={loading}>
              {loading ? "Abriendo…" : "Abrir turno"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function OpenShiftCard({
  shift,
  expected,
  totals,
  canManage,
}: {
  shift: OpenShift;
  expected: number;
  totals: ShiftTotals | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [resumen, setResumen] = useState<ArqueoCerrado | null>(null);

  const contado = counted.trim() === "" ? null : toNumber(counted);
  const diferencia = contado === null ? null : round2(contado - expected);

  async function cerrar() {
    setError(null);
    if (contado === null) {
      setError("Escribe cuánto efectivo contaste, aunque sea 0.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/cash-shifts/${shift.id}/close`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countedAmount: contado, notes }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "No se pudo cerrar el turno.");
        return;
      }
      // Se muestra el arqueo que devolvió el servidor, no el que la pantalla
      // había calculado. El esperado de la pantalla es una foto del momento
      // en que se cargó: si alguien cobró en efectivo en otro mostrador
      // mientras se contaba, el servidor congela otra cifra. Descartarla
      // dejaría al cajero creyendo que cuadró un turno que quedó con
      // faltante, sin saber de dónde salió.
      const cerrado = (await res.json()) as ArqueoCerrado;
      setResumen(cerrado);
      setCounted("");
      setNotes("");
      setConfirmando(false);
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor. Revisa la conexión y vuelve a intentar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-3">
              Turno #{shift.number} abierto
              <Badge tone="good">Abierto</Badge>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-8">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Desde</p>
              <p className="text-sm text-slate-700">{formatDate(shift.openedAt)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Fondo</p>
              <p className="text-sm text-slate-700">{formatCurrency(shift.openingAmount)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Ventas del turno</p>
              <p className="text-sm text-slate-700">{totals?.ventas ?? 0}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">
                Efectivo esperado
              </p>
              <p className="text-base font-semibold text-brand-900">
                {formatCurrency(expected)}
              </p>
            </div>
          </div>
          {shift.openingNotes && (
            <p className="mt-4 text-sm text-slate-500">Nota de apertura: {shift.openingNotes}</p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Cobrado en este turno</CardTitle>
        </CardHeader>
        <CardContent>
          {!totals || totals.total === 0 ? (
            <p className="text-sm text-slate-500">
              Todavía no se ha cobrado nada en este turno.
            </p>
          ) : (
            <div className="flex flex-wrap gap-8">
              {(Object.keys(totals.porMedio) as PaymentMethod[]).map((medio) => (
                <div key={medio}>
                  <p className="text-xs uppercase tracking-wide text-slate-400">
                    {paymentMethodLabels[medio] ?? medio}
                  </p>
                  <p className="text-sm font-medium text-slate-700">
                    {formatCurrency(totals.porMedio[medio])}
                  </p>
                </div>
              ))}
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Total</p>
                <p className="text-base font-semibold text-brand-900">
                  {formatCurrency(totals.total)}
                </p>
              </div>
            </div>
          )}
          <p className="mt-4 text-xs text-slate-500">
            Solo el efectivo se cuenta al cerrar. Débito, crédito y transferencia no pasan por el
            cajón.
          </p>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Cerrar turno</CardTitle>
        </CardHeader>
        <CardContent>
          {!canManage ? (
            <p className="text-sm text-slate-500">No tienes permiso para cerrar la caja.</p>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                Cuenta el efectivo del cajón, incluido el fondo, y escribe el total. La diferencia
                no es un reproche: un vuelto mal dado deja sobrante igual que un cobro sin
                registrar. Para eso está la nota.
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_1fr]">
                <div>
                  <Label htmlFor="turno-contado">Efectivo contado</Label>
                  <Input
                    id="turno-contado"
                    type="number"
                    min="0"
                    step="0.01"
                    value={counted}
                    onChange={(e) => {
                      setError(null);
                      setConfirmando(false);
                      setCounted(e.target.value);
                    }}
                    placeholder="0"
                  />
                </div>
                <div>
                  <Label htmlFor="turno-cierre-nota">Nota de cierre</Label>
                  <Input
                    id="turno-cierre-nota"
                    maxLength={500}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Opcional. Si no cuadra, acá se explica."
                  />
                </div>
              </div>

              {diferencia !== null && (
                <div className="flex items-center gap-3 rounded-md bg-slate-50 px-3 py-2">
                  <Badge tone={differenceTone(diferencia)}>{differenceLabel(diferencia)}</Badge>
                  <span className="text-sm text-slate-600">
                    Esperado {formatCurrency(expected)} · contado {formatCurrency(contado ?? 0)}
                    {diferencia !== 0 &&
                      ` · ${diferencia > 0 ? "sobran" : "faltan"} ${formatCurrency(
                        Math.abs(diferencia)
                      )}`}
                  </span>
                </div>
              )}

              {error && (
                <p className="text-sm text-red-600" role="alert">
                  {error}
                </p>
              )}

              {resumen && (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
                  <p className="mb-2 text-sm font-medium text-brand-900">
                    Turno #{resumen.number} cerrado
                  </p>
                  <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                    <span>Esperado {formatCurrency(resumen.expectedAmount ?? 0)}</span>
                    <span>Contado {formatCurrency(resumen.countedAmount ?? 0)}</span>
                    <Badge tone={differenceTone(resumen.difference ?? 0)}>
                      {differenceLabel(resumen.difference ?? 0)}
                    </Badge>
                    {round2(resumen.difference ?? 0) !== 0 && (
                      <span>{formatCurrency(Math.abs(toNumber(resumen.difference)))}</span>
                    )}
                  </div>
                  {round2(resumen.difference ?? 0) !== 0 && (
                    <p className="mt-2 text-xs text-slate-500">
                      Si el esperado no es el que veías en pantalla, es que entró un cobro en
                      efectivo mientras contabas. Queda registrado así.
                    </p>
                  )}
                </div>
              )}

              {confirmando ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-600">
                    El cierre congela el arqueo y no se puede deshacer. ¿Cerrar el turno?
                  </span>
                  <Button variant="secondary" onClick={() => setConfirmando(false)} disabled={loading}>
                    Cancelar
                  </Button>
                  <Button onClick={cerrar} disabled={loading}>
                    {loading ? "Cerrando…" : "Sí, cerrar"}
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={() => {
                    // Trae el esperado de nuevo antes de preguntar: entre que
                    // se abrió la pantalla y ahora pudo entrar un cobro.
                    router.refresh();
                    setConfirmando(true);
                  }}
                  disabled={loading}
                >
                  Cerrar turno
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
