"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { formatQuantity, round3, sumQuantities, toNumber } from "@/lib/decimal";
import { scaleRecipe } from "@/lib/production";

interface StockLevel {
  quantity: number | string;
  warehouseId: string;
}

interface RecipeItem {
  variantId: string;
  quantity: number | string;
  variant: {
    sku: string;
    unit: string;
    product: { name: string };
    stockLevels: StockLevel[];
  };
}

interface Recipe {
  yield: number | string;
  active: boolean;
  items: RecipeItem[];
}

interface Variant {
  id: string;
  sku: string;
  unit: string;
  product: { name: string };
  stockLevels: StockLevel[];
  recipe: Recipe | null;
}

interface ProductionItemRow {
  variantId: string;
  quantityProduced: number | string;
  quantityWasted: number | string;
  variant: { sku: string; unit: string; product: { name: string } };
}

interface Production {
  id: string;
  number: number;
  producedOn: string;
  notes: string | null;
  warehouse: { name: string };
  createdBy: { name: string | null };
  items: ProductionItemRow[];
}

interface Line {
  /** Identidad estable de la fila. Usar el índice como key de React hace que
   *  al quitar una fila del medio el foco y el texto salten a otra. */
  id: string;
  variantId: string;
  produced: string;
  wasted: string;
}

// La primera fila lleva un id fijo. El estado inicial se calcula también al
// renderizar en el servidor, así que cualquier valor que no sea determinista
// —un aleatorio, o un contador de módulo que en el servidor no se reinicia
// entre visitas— haría que servidor y cliente generen ids distintos y React
// avise de un desajuste de hidratación. Las filas que se agregan después nacen
// solo en el navegador, y ahí un contador por componente sí sirve.
const PRIMERA_LINEA = "linea-0";

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function primeraLinea(variantId: string): Line {
  return { id: PRIMERA_LINEA, variantId, produced: "", wasted: "" };
}

export function ProductionClient({
  variants,
  productions,
  warehouse,
  canManage,
}: {
  variants: Variant[];
  productions: Production[];
  warehouse: { id: string; name: string } | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const variantsById = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants]);

  // Los que tienen receta van primero: son los que se hornean.
  const orderedVariants = useMemo(
    () => [...variants].sort((a, b) => Number(Boolean(b.recipe)) - Number(Boolean(a.recipe))),
    [variants]
  );

  // Vacía al principio y se completa tras montar: today() depende de la zona
  // horaria de quien la ejecuta, y en el servidor es UTC. Entre las 21:00 y
  // medianoche en Chile ya es el día siguiente allá, justo a la hora del
  // cierre, y servidor y navegador pintarían fechas distintas.
  const [producedOn, setProducedOn] = useState("");
  useEffect(() => {
    setProducedOn((actual) => actual || today());
  }, []);

  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([primeraLinea(orderedVariants[0]?.id ?? "")]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lineCounter = useRef(0);

  function nuevaLinea(variantId: string): Line {
    lineCounter.current += 1;
    return { id: `linea-${lineCounter.current}`, variantId, produced: "", wasted: "" };
  }

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  /**
   * Stock por variante en la bodega desde la que se va a descontar.
   *
   * Incluye los insumos que solo aparecen dentro de una receta: pueden estar
   * desactivados en el catálogo —un formato de saco descontinuado— y entonces
   * no vienen en la lista de variantes activas. Sin esto se mostrarían con
   * stock cero y la pantalla avisaría de una falta inexistente.
   */
  const stockByVariant = useMemo(() => {
    const total = new Map<string, number>();
    const agregar = (id: string, levels: StockLevel[]) => {
      if (total.has(id)) return;
      total.set(
        id,
        sumQuantities(
          levels
            .filter((l) => !warehouse || l.warehouseId === warehouse.id)
            .map((l) => l.quantity)
        )
      );
    };
    for (const v of variants) agregar(v.id, v.stockLevels);
    for (const v of variants) {
      for (const item of v.recipe?.items ?? []) agregar(item.variantId, item.variant.stockLevels ?? []);
    }
    return total;
  }, [variants, warehouse]);

  // La fila nueva arranca con el primer producto que todavía no está en la
  // lista. Repetir el de por defecto hacía que dos clics mandaran el mismo
  // producto dos veces y la producción se rechazara entera.
  function addLine() {
    setLines((prev) => {
      const usados = new Set(prev.map((l) => l.variantId));
      const libre = orderedVariants.find((v) => !usados.has(v.id));
      return [...prev, nuevaLinea(libre?.id ?? orderedVariants[0]?.id ?? "")];
    });
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  /** Lo que esta producción va a descontar del inventario, insumo por insumo. */
  const consumption = useMemo(() => {
    // Lo que la misma orden produce cuenta como disponible: si en un registro
    // van masa y pan, y el pan consume masa, el servidor produce la masa antes
    // de consumirla. Sin esto la pantalla anunciaría un rechazo que no ocurre.
    const producidoAquí = new Map<string, number>();
    for (const line of lines) {
      const q = toNumber(line.produced);
      if (q > 0) producidoAquí.set(line.variantId, round3((producidoAquí.get(line.variantId) ?? 0) + q));
    }

    const totals = new Map<string, { name: string; sku: string; unit: string; quantity: number; stock: number }>();
    for (const line of lines) {
      const variant = variantsById.get(line.variantId);
      const produced = toNumber(line.produced);
      if (!variant?.recipe?.active || produced <= 0) continue;
      if (toNumber(variant.recipe.yield) <= 0) continue;

      for (const need of scaleRecipe(variant.recipe, produced)) {
        const input = variant.recipe.items.find((i) => i.variantId === need.variantId);
        if (!input) continue;
        const current = totals.get(need.variantId);
        totals.set(need.variantId, {
          name: input.variant.product.name,
          sku: input.variant.sku,
          unit: input.variant.unit,
          // round3 al acumular: sumar floats sin redondear daba 3,3300000000000005
          // para diez líneas de 0,333 y marcaba falta de stock con 3,33 exactos.
          quantity: round3((current?.quantity ?? 0) + need.quantity),
          stock: round3(
            (stockByVariant.get(need.variantId) ?? 0) + (producidoAquí.get(need.variantId) ?? 0)
          ),
        });
      }
    }
    return Array.from(totals.values());
  }, [lines, variantsById, stockByVariant]);

  // Tolerancia de una diezmilésima: por debajo de eso es ruido de punto
  // flotante, no falta de stock.
  const faltantes = consumption.filter((c) => c.quantity - c.stock > 0.0001);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setOk(null);

    const items = lines
      .filter((l) => l.variantId)
      .map((l) => ({
        variantId: l.variantId,
        quantityProduced: toNumber(l.produced),
        quantityWasted: toNumber(l.wasted),
      }));

    if (!items.some((i) => i.quantityProduced > 0 || i.quantityWasted > 0)) {
      setError("Registra al menos una cantidad producida o una merma.");
      return;
    }

    const repetido = items.find((i, idx) => items.findIndex((o) => o.variantId === i.variantId) !== idx);
    if (repetido) {
      const nombre = variantsById.get(repetido.variantId)?.product.name ?? "un producto";
      setError(`${nombre} está dos veces en la lista. Junta las cantidades en una sola fila.`);
      return;
    }

    if (!producedOn) {
      setError("Elige la fecha de la producción.");
      return;
    }

    // Mediodía local: enviar solo la fecha la interpretaría como medianoche UTC
    // y en Chile quedaría registrada el día anterior.
    const fecha = new Date(`${producedOn}T12:00:00`);
    if (Number.isNaN(fecha.getTime())) {
      setError("La fecha no es válida.");
      return;
    }

    // try/finally: sin esto, cualquier fallo antes de la respuesta —la red, un
    // JSON mal formado— dejaba el botón en "Registrando…" para siempre y sin
    // mensaje, porque setLoading(false) no llegaba a ejecutarse.
    setLoading(true);
    try {
      const res = await fetch("/api/productions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseId: warehouse?.id,
          producedOn: fecha.toISOString(),
          notes,
          items,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          typeof data.error === "string" ? data.error : "No se pudo registrar la producción."
        );
        return;
      }

      setLines([primeraLinea(orderedVariants[0]?.id ?? "")]);
      setNotes("");
      setOk("Producción registrada.");
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor. Revisa la conexión y vuelve a intentar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
        <h1 className="text-xl font-semibold text-brand-900">Producción</h1>
        <p className="text-sm text-slate-500">
          En la mañana registra lo que salió del horno; al cierre, lo que no se vendió. Los insumos
          se descuentan solos según la receta de cada producto
          {warehouse ? `, desde ${warehouse.name}` : ""}.
        </p>
        </div>
        {canManage && (
          <Link href="/production/recipes">
            <Button variant="secondary">Recetas</Button>
          </Link>
        )}
      </div>

      {canManage && variants.length === 0 && (
        <Card>
          <CardContent>
            <p className="py-6 text-center text-sm text-slate-500">
              No hay productos activos en el catálogo. Crea al menos uno para poder registrar
              producciones.
            </p>
          </CardContent>
        </Card>
      )}

      {canManage && !warehouse && (
        <p className="text-sm text-red-600">
          No hay ninguna bodega marcada como predeterminada, así que no se puede registrar
          producción todavía.
        </p>
      )}

      {canManage && variants.length > 0 && warehouse && (
        <form onSubmit={handleSubmit} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Lo que se produjo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="max-w-xs">
                <Label htmlFor="prod-date">Fecha</Label>
                <Input
                  id="prod-date"
                  type="date"
                  value={producedOn}
                  onChange={(e) => setProducedOn(e.target.value)}
                />
              </div>

              <div className="space-y-3">
                {lines.map((line, index) => {
                  const variant = variantsById.get(line.variantId);
                  return (
                    <div
                      key={line.id}
                      className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_7rem_7rem_auto] sm:items-end"
                    >
                      <div>
                        <Label htmlFor={`prod-variant-${line.id}`}>Producto</Label>
                        <Select
                          id={`prod-variant-${line.id}`}
                          value={line.variantId}
                          onChange={(e) => updateLine(index, { variantId: e.target.value })}
                        >
                          {orderedVariants.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.product.name} ({v.sku})
                              {!v.recipe
                                ? " — sin receta"
                                : v.recipe.active
                                  ? ""
                                  : " — receta desactivada"}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor={`prod-qty-${line.id}`}>
                          Producido{variant ? ` (${variant.unit === "UN" ? "uds." : variant.unit})` : ""}
                        </Label>
                        <Input
                          id={`prod-qty-${line.id}`}
                          type="number"
                          min="0"
                          step="0.001"
                          placeholder="0"
                          value={line.produced}
                          onChange={(e) => updateLine(index, { produced: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`prod-waste-${line.id}`}>Merma</Label>
                        <Input
                          id={`prod-waste-${line.id}`}
                          type="number"
                          min="0"
                          step="0.001"
                          placeholder="0"
                          value={line.wasted}
                          onChange={(e) => updateLine(index, { wasted: e.target.value })}
                        />
                      </div>
                      {lines.length > 1 && (
                        <Button type="button" variant="ghost" onClick={() => removeLine(index)}>
                          Quitar
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>

              <Button type="button" variant="secondary" onClick={addLine}>
                Agregar producto
              </Button>

              <div>
                <Label htmlFor="prod-notes">Notas</Label>
                <Input
                  id="prod-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Opcional"
                />
              </div>
            </CardContent>
          </Card>

          {consumption.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Insumos que se van a descontar</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Insumo</Th>
                      <Th>Necesario</Th>
                      <Th>En stock</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {consumption.map((c) => (
                      <Tr key={c.sku}>
                        <Td>
                          {c.name}{" "}
                          <span className="font-mono text-xs text-slate-400">({c.sku})</span>
                        </Td>
                        <Td>{formatQuantity(c.quantity, c.unit)}</Td>
                        <Td className={c.quantity - c.stock > 0.0001 ? "text-red-700" : "text-slate-500"}>
                          {formatQuantity(c.stock, c.unit)}
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </CardContent>
            </Card>
          )}

          {faltantes.length > 0 && (
            <p className="text-sm text-red-600" role="alert">
              No alcanza el stock de {faltantes.map((f) => f.sku).join(", ")}. La producción se va
              a rechazar completa.
            </p>
          )}

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          {ok && (
            <p className="text-sm text-emerald-700" role="status">
              {ok}
            </p>
          )}

          <Button type="submit" disabled={loading}>
            {loading ? "Registrando…" : "Registrar producción"}
          </Button>
        </form>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Últimas producciones</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {productions.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">
              Todavía no hay producciones registradas.
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>N°</Th>
                  <Th>Fecha</Th>
                  <Th>Productos</Th>
                  <Th>Producido</Th>
                  <Th>Merma</Th>
                  <Th>Quién</Th>
                </Tr>
              </Thead>
              <Tbody>
                {productions.map((p) => {
                  const producido = sumQuantities(p.items.map((i) => i.quantityProduced));
                  const merma = sumQuantities(p.items.map((i) => i.quantityWasted));
                  return (
                    <Tr key={p.id}>
                      <Td className="font-medium">#{p.number}</Td>
                      <Td className="whitespace-nowrap text-xs text-slate-500">
                        {formatDate(p.producedOn)}
                      </Td>
                      <Td>
                        {p.items.map((i) => i.variant.product.name).join(", ") || "—"}
                      </Td>
                      <Td>{formatQuantity(producido)}</Td>
                      <Td>
                        {merma > 0 ? (
                          <Badge tone="warn">{formatQuantity(merma)}</Badge>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </Td>
                      <Td className="text-slate-500">{p.createdBy.name || "—"}</Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
