"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { formatQuantity, toNumber } from "@/lib/decimal";
import {
  diasHastaVencer,
  estadoVencimiento,
  estadoVencimientoLabels,
  estadoVencimientoTone,
  fechaParaInput,
  vencimientoSugerido,
  type EstadoVencimiento,
} from "@/lib/lots";

interface LoteRow {
  id: string;
  code: string;
  expiresAt: string | null;
  receivedAt: string;
  quantity: string;
  status: string;
  notes: string | null;
  variant: {
    id: string;
    sku: string;
    unit: string;
    nearExpiryDays: number | null;
    product: { name: string };
  };
  warehouse: { name: string };
}

interface VarianteOpcion {
  id: string;
  sku: string;
  nombre: string;
  unidad: string;
  shelfLifeDays: number | null;
}

const filtros = ["TODOS", "VENCIDO", "POR_VENCER", "VIGENTE"] as const;
type Filtro = (typeof filtros)[number];

const filtroLabels: Record<Filtro, string> = {
  TODOS: "Todos",
  VENCIDO: "Vencidos",
  POR_VENCER: "Por vencer",
  VIGENTE: "Vigentes",
};

export function LotsClient({
  lots,
  variants,
  warehouseName,
  canManage,
}: {
  lots: LoteRow[];
  variants: VarianteOpcion[];
  warehouseName: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [filtro, setFiltro] = useState<Filtro>("TODOS");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, setPendiente] = useState<string | null>(null);

  // `ahora` arranca en null y se fija después de montar.
  //
  // Calcularlo durante el render lo evaluaría dos veces —una en el servidor
  // y otra al hidratar— y cerca de la medianoche chilena los dos valores
  // caen en días distintos: React reportaría desajuste y los contadores
  // parpadearían. Con null, el primer render no clasifica nada y el
  // segundo, ya en el navegador, usa la hora del local.
  const [ahora, setAhora] = useState<Date | null>(null);
  useEffect(() => setAhora(new Date()), []);

  const conEstado = lots.map((lote) => ({
    lote,
    estado: ahora
      ? estadoVencimiento(
          lote.expiresAt ? new Date(lote.expiresAt) : null,
          lote.variant.nearExpiryDays,
          ahora
        )
      : ("SIN_VENCIMIENTO" as EstadoVencimiento),
    dias: ahora
      ? diasHastaVencer(lote.expiresAt ? new Date(lote.expiresAt) : null, ahora)
      : null,
  }));

  const visibles = filtro === "TODOS" ? conEstado : conEstado.filter((f) => f.estado === filtro);

  const cuenta = (estado: EstadoVencimiento) =>
    conEstado.filter((f) => f.estado === estado).length;

  async function cambiarEstado(id: string, status: string) {
    if (pendiente) return;
    setPendiente(id);
    setError(null);
    try {
      const res = await fetch(`/api/lots/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "No se pudo actualizar el lote.");
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor. Revisa la conexión y vuelve a intentar.");
    } finally {
      setPendiente(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-brand-900">Lotes y vencimientos</h1>
        <p className="text-sm text-slate-500">
          Cada venta despacha primero lo que vence antes. Esta pantalla es para ver qué hay que
          rebajar o sacar de circulación antes de que se pierda.
          {warehouseName && ` Bodega ${warehouseName}.`}
        </p>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <ResumenTarjeta titulo="Vencidos" valor={cuenta("VENCIDO")} tono="critical" />
        <ResumenTarjeta titulo="Por vencer" valor={cuenta("POR_VENCER")} tono="warn" />
        <ResumenTarjeta titulo="Vigentes" valor={cuenta("VIGENTE")} tono="good" />
      </div>

      {canManage && <RecepcionLote variants={variants} />}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>
            <span className="flex flex-wrap items-center gap-2">
              Lotes con stock
              {filtros.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFiltro(f)}
                  className={
                    filtro === f
                      ? "rounded-full bg-brand-700 px-3 py-1 text-xs font-medium text-white"
                      : "rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600"
                  }
                >
                  {filtroLabels[f]}
                </button>
              ))}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error && (
            <p className="px-5 pt-4 text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          {visibles.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">
              {lots.length === 0
                ? "Todavía no hay lotes registrados. Activa el seguimiento por lote en los productos que vencen y recibe el primero acá arriba."
                : "Ningún lote en ese estado."}
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Producto</Th>
                  <Th>Lote</Th>
                  <Th>Cantidad</Th>
                  <Th>Vence</Th>
                  <Th>Estado</Th>
                  {canManage && <Th />}
                </Tr>
              </Thead>
              <Tbody>
                {visibles.map(({ lote, estado, dias }) => (
                  <Tr key={lote.id}>
                    <Td>
                      {lote.variant.product.name}{" "}
                      <span className="font-mono text-xs text-slate-400">({lote.variant.sku})</span>
                    </Td>
                    <Td className="font-mono text-xs">{lote.code}</Td>
                    <Td>{formatQuantity(lote.quantity, lote.variant.unit)}</Td>
                    <Td className="whitespace-nowrap text-xs text-slate-500">
                      {lote.expiresAt ? (
                        <>
                          {formatDate(lote.expiresAt).split(",")[0]}
                          {dias !== null && (
                            <span className="ml-1 text-slate-400">
                              ({dias < 0 ? `hace ${-dias} d` : dias === 0 ? "hoy" : `en ${dias} d`})
                            </span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>
                      <span className="flex items-center gap-2">
                        <Badge tone={estadoVencimientoTone[estado]}>
                          {estadoVencimientoLabels[estado]}
                        </Badge>
                        {lote.status !== "DISPONIBLE" && (
                          <Badge tone="neutral">{lote.status === "BLOQUEADO" ? "Bloqueado" : "Fuera"}</Badge>
                        )}
                      </span>
                    </Td>
                    {canManage && (
                      <Td>
                        {lote.status === "DISPONIBLE" ? (
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={pendiente === lote.id}
                            onClick={() => cambiarEstado(lote.id, "BLOQUEADO")}
                          >
                            Bloquear
                          </Button>
                        ) : estado === "VENCIDO" ? (
                          // Liberar un lote vencido no lo haría vendible: el
                          // filtro por fecha lo sigue dejando fuera. Ofrecer
                          // el botón sería prometer algo que no pasa.
                          <span className="text-xs text-slate-400">Vencido</span>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={pendiente === lote.id}
                            onClick={() => cambiarEstado(lote.id, "DISPONIBLE")}
                          >
                            Liberar
                          </Button>
                        )}
                      </Td>
                    )}
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="mt-4 text-xs text-slate-500">
        Bloquear o liberar no mueve stock: lo bloqueado sigue estando en la bodega y sigue
        contando en el inventario, solo deja de ofrecerse para la venta. Botarlo es una merma y se
        registra desde Inventario, con su motivo.
      </p>
    </div>
  );
}

function ResumenTarjeta({
  titulo,
  valor,
  tono,
}: {
  titulo: string;
  valor: number;
  tono: "good" | "warn" | "critical";
}) {
  const color =
    tono === "critical" ? "text-red-700" : tono === "warn" ? "text-amber-700" : "text-emerald-700";
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs uppercase tracking-wide text-slate-400">{titulo}</p>
        <p className={`text-2xl font-semibold ${color}`}>{valor}</p>
      </CardContent>
    </Card>
  );
}

function RecepcionLote({ variants }: { variants: VarianteOpcion[] }) {
  const router = useRouter();
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const variante = variants.find((v) => v.id === variantId) ?? null;

  // Se propone el vencimiento desde la vida útil declarada del producto, que
  // es lo que evita tipear una fecha por cada caja. Se puede corregir.
  function elegirVariante(id: string) {
    setVariantId(id);
    const elegida = variants.find((v) => v.id === id);
    const sugerido = vencimientoSugerido(elegida?.shelfLifeDays ?? null);
    // Se asigna siempre, también vacío: si no, al cambiar a un producto sin
    // vida útil declarada quedaba pegada la fecha del anterior y el queso se
    // recibía con el vencimiento del pan.
    setExpiresAt(sugerido ? fechaParaInput(sugerido) : "");
  }

  // La sugerencia también para la variante que viene seleccionada de fábrica.
  useEffect(() => {
    if (variantId) elegirVariante(variantId);
    // Solo al montar: después manda lo que elija la persona.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function recibir(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/lots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantId, code, quantity: toNumber(quantity), expiresAt }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "No se pudo recibir el lote.");
        return;
      }
      setCode("");
      setQuantity("");
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor. Revisa la conexión y vuelve a intentar.");
    } finally {
      setLoading(false);
    }
  }

  if (variants.length === 0) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-slate-500">
          Ningún producto tiene el seguimiento por lote activado. Se activa en la ficha del
          producto, en la variante: ahí también se declara la vida útil y con cuántos días de
          anticipación avisar. El pan no necesita el mismo aviso que un tarro de conservas.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recibir lote</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={recibir} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <Label htmlFor="lote-producto">Producto</Label>
              <Select
                id="lote-producto"
                value={variantId}
                onChange={(e) => elegirVariante(e.target.value)}
              >
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nombre} ({v.sku})
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="lote-codigo">Número de lote</Label>
              <Input
                id="lote-codigo"
                required
                maxLength={60}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="El del envase"
              />
            </div>
            <div>
              <Label htmlFor="lote-cantidad">Cantidad</Label>
              <Input
                id="lote-cantidad"
                type="number"
                min="0.001"
                step="0.001"
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="lote-vence">Vence</Label>
              <Input
                id="lote-vence"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </div>

          {variante?.shelfLifeDays && (
            <p className="text-xs text-slate-500">
              {variante.nombre} declara {variante.shelfLifeDays} días de vida útil; la fecha se
              propone desde ahí y se puede corregir.
            </p>
          )}

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading}>
            {loading ? "Recibiendo…" : "Recibir"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
