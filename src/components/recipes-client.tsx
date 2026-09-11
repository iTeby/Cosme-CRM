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
import { formatQuantity, round3, toNumber } from "@/lib/decimal";

interface RecipeItem {
  variantId: string;
  quantity: number | string;
  variant: { sku: string; unit: string; product: { name: string } };
}

interface Recipe {
  yield: number | string;
  notes: string | null;
  active: boolean;
  items: RecipeItem[];
}

interface Variant {
  id: string;
  sku: string;
  unit: string;
  active?: boolean;
  product: { name: string };
  recipe?: Recipe | null;
}

/** Una línea del editor, con identidad propia para no usar el índice como key. */
interface EditorLine {
  id: string;
  variantId: string;
  quantity: string;
}

function unidadCorta(unit: string) {
  return unit === "UN" ? "uds." : unit.toLowerCase();
}

function unidadSingular(unit: string) {
  return unit === "UN" ? "unidad" : unit.toLowerCase();
}

export function RecipesClient({
  variants,
  insumosInactivos,
  canManage,
}: {
  variants: Variant[];
  insumosInactivos: Variant[];
  canManage: boolean;
}) {
  const router = useRouter();
  const lineCounter = useRef(0);
  const editorRef = useRef<HTMLDivElement | null>(null);

  // Índice de TODAS las variantes conocidas, activas o no: una receta puede
  // apuntar a un insumo desactivado y hay que poder mostrarlo y conservarlo.
  const variantsById = useMemo(
    () => new Map([...variants, ...insumosInactivos].map((v) => [v.id, v])),
    [variants, insumosInactivos]
  );

  // Copia propia y no una búsqueda en la lista: si un refresco de datos deja de
  // traer este producto, el editor no debe desaparecer con lo que se estaba
  // escribiendo adentro.
  const [selected, setSelected] = useState<Variant | null>(null);
  const [tieneReceta, setTieneReceta] = useState(false);
  const [yieldQty, setYieldQty] = useState("");
  const [active, setActive] = useState(true);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<EditorLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);
  const [loading, setLoading] = useState(false);

  /**
   * Cualquier cambio invalida el "Receta guardada." de la vez anterior.
   * Dejarlo visible mientras hay ediciones sin enviar es peor que no mostrarlo:
   * la dueña corrige un número, ve el mensaje verde y cierra convencida de que
   * quedó guardado.
   */
  function tocar() {
    setOk(null);
    setConfirmandoBorrado(false);
  }

  function nuevaLinea(variantId: string): EditorLine {
    lineCounter.current += 1;
    return { id: `insumo-${lineCounter.current}`, variantId, quantity: "" };
  }

  /**
   * Insumos elegibles: todas las variantes activas menos el producto que se
   * está editando, más los insumos desactivados que esta receta ya usa.
   */
  const posiblesInsumos = useMemo(() => {
    if (!selected) return [];
    const usadosDesactivados = (selected.recipe?.items ?? [])
      .map((i) => variantsById.get(i.variantId))
      .filter((v): v is Variant => Boolean(v) && v!.active === false);
    const activos = variants.filter((v) => v.id !== selected.id);
    const yaIncluidos = new Set(activos.map((v) => v.id));
    return [...activos, ...usadosDesactivados.filter((v) => !yaIncluidos.has(v.id))];
  }, [variants, variantsById, selected]);

  const sinInsumosPosibles = variants.length <= 1;

  function editar(variant: Variant) {
    setSelected(variant);
    setTieneReceta(Boolean(variant.recipe));
    setError(null);
    setOk(null);
    setConfirmandoBorrado(false);
    const receta = variant.recipe;
    // Vacío al crear: prellenar con 1 invita a cargar la batida completa
    // dejando el rinde en 1, y entonces producir 200 panes escala por 200.
    setYieldQty(receta ? String(toNumber(receta.yield)) : "");
    setActive(receta ? receta.active : true);
    setNotes(receta?.notes ?? "");
    const primerInsumo = variants.find((v) => v.id !== variant.id)?.id ?? "";
    setLines(
      receta && receta.items.length > 0
        ? receta.items.map((i) => {
            lineCounter.current += 1;
            return {
              id: `insumo-${lineCounter.current}`,
              variantId: i.variantId,
              quantity: String(toNumber(i.quantity)),
            };
          })
        : [nuevaLinea(primerInsumo)]
    );
  }

  // Llevar la vista al editor: con un catálogo largo, abrirlo arriba del todo
  // no produce ningún cambio visible donde la persona está mirando.
  useEffect(() => {
    if (!selected) return;
    editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selected]);

  function cerrar() {
    setSelected(null);
    setLines([]);
    setError(null);
    setOk(null);
    setConfirmandoBorrado(false);
  }

  function updateLine(index: number, patch: Partial<EditorLine>) {
    tocar();
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function addLine() {
    tocar();
    setLines((prev) => {
      const usados = new Set(prev.map((l) => l.variantId));
      const libre = posiblesInsumos.find((v) => !usados.has(v.id));
      return [...prev, nuevaLinea(libre?.id ?? posiblesInsumos[0]?.id ?? "")];
    });
  }

  function removeLine(index: number) {
    tocar();
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  /** Cuánto insumo consume UNA unidad del producto. Es como se lee una receta. */
  const porUnidad = useMemo(() => {
    const rinde = toNumber(yieldQty);
    if (rinde <= 0) return [];
    return lines
      .filter((l) => l.variantId && toNumber(l.quantity) > 0)
      .map((l) => ({
        id: l.id,
        sku: variantsById.get(l.variantId)?.sku ?? "",
        unit: variantsById.get(l.variantId)?.unit ?? "UN",
        cantidad: round3(toNumber(l.quantity) / rinde),
      }));
  }, [lines, yieldQty, variantsById]);

  async function guardar(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setError(null);
    setOk(null);

    const items = lines
      .filter((l) => l.variantId)
      .map((l) => ({ variantId: l.variantId, quantity: toNumber(l.quantity) }));

    if (items.length === 0) {
      setError("Agrega al menos un insumo.");
      return;
    }
    if (items.some((i) => i.quantity <= 0)) {
      setError("Todos los insumos necesitan una cantidad mayor que 0.");
      return;
    }
    const repetido = items.find(
      (i, idx) => items.findIndex((o) => o.variantId === i.variantId) !== idx
    );
    if (repetido) {
      const nombre = variantsById.get(repetido.variantId)?.product.name ?? "un insumo";
      setError(`${nombre} está dos veces. Junta las cantidades en una sola línea.`);
      return;
    }
    if (toNumber(yieldQty) <= 0) {
      setError("El rendimiento tiene que ser mayor que 0.");
      return;
    }

    const destino = selected.id;
    setLoading(true);
    try {
      const res = await fetch(`/api/recipes/${destino}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yield: toNumber(yieldQty), notes, active, items }),
      });

      // Si mientras tanto se abrió otro producto, la respuesta ya no
      // corresponde a lo que está en pantalla y no debe pintar nada ahí.
      if (destino !== selected?.id) return;

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "No se pudo guardar la receta.");
        return;
      }

      setTieneReceta(true);
      setOk("Receta guardada.");
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor. Revisa la conexión y vuelve a intentar.");
    } finally {
      setLoading(false);
    }
  }

  async function eliminar() {
    if (!selected) return;
    setError(null);
    setOk(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/recipes/${selected.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "No se pudo eliminar la receta.");
        return;
      }
      cerrar();
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setLoading(false);
    }
  }

  const conReceta = variants.filter((v) => v.recipe);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-brand-900">Recetas</h1>
          <p className="text-sm text-slate-500">
            La receta dice cuánto insumo consume cada producción. Sin receta, el producto se registra
            igual pero no descuenta nada.
          </p>
        </div>
        <Link href="/production">
          <Button variant="secondary">Volver a Producción</Button>
        </Link>
      </div>

      <div ref={editorRef}>
        {selected && canManage && (
          <Card>
            <CardHeader>
              <CardTitle>
                Receta de {selected.product.name}{" "}
                <span className="font-mono text-xs font-normal text-slate-400">
                  ({selected.sku})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={guardar} className="space-y-5">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="w-44">
                    <Label htmlFor="receta-rinde">Rinde</Label>
                    <Input
                      id="receta-rinde"
                      type="number"
                      min="0.001"
                      step="0.001"
                      required
                      autoFocus
                      placeholder="¿Cuántas produce?"
                      value={yieldQty}
                      onChange={(e) => {
                        tocar();
                        setYieldQty(e.target.value);
                      }}
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      {unidadCorta(selected.unit)} que produce la receta completa
                    </p>
                  </div>
                  <label className="flex items-center gap-2 pb-6 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(e) => {
                        tocar();
                        setActive(e.target.checked);
                      }}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Receta vigente
                  </label>
                </div>

                {!active && (
                  <p className="text-sm text-amber-700">
                    Mientras esté desactivada, producir este producto no descuenta ningún insumo.
                  </p>
                )}

                <div className="space-y-3">
                  <Label>Insumos</Label>
                  {lines.map((line, index) => {
                    const insumo = variantsById.get(line.variantId);
                    return (
                      <div
                        key={line.id}
                        className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_9rem_auto] sm:items-end"
                      >
                        <div>
                          <Label htmlFor={`insumo-${line.id}`}>Insumo</Label>
                          <Select
                            id={`insumo-${line.id}`}
                            value={line.variantId}
                            onChange={(e) => updateLine(index, { variantId: e.target.value })}
                          >
                            {posiblesInsumos.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.product.name} ({v.sku})
                                {v.active === false ? " — desactivado" : ""}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor={`cantidad-${line.id}`}>
                            Cantidad{insumo ? ` (${unidadCorta(insumo.unit)})` : ""}
                          </Label>
                          <Input
                            id={`cantidad-${line.id}`}
                            type="number"
                            min="0.001"
                            step="0.001"
                            placeholder="0"
                            value={line.quantity}
                            onChange={(e) => updateLine(index, { quantity: e.target.value })}
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
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={addLine}
                    disabled={lines.length >= posiblesInsumos.length}
                  >
                    Agregar insumo
                  </Button>
                </div>

                {porUnidad.length > 0 && (
                  <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    Por cada {unidadSingular(selected.unit)} de {selected.product.name} se descuenta{" "}
                    {porUnidad
                      .map((p) => `${formatQuantity(p.cantidad, p.unit)} de ${p.sku}`)
                      .join(", ")}
                    .
                  </div>
                )}

                <div>
                  <Label htmlFor="receta-notas">Notas</Label>
                  <Input
                    id="receta-notas"
                    maxLength={500}
                    value={notes}
                    onChange={(e) => {
                      tocar();
                      setNotes(e.target.value);
                    }}
                    placeholder="Opcional"
                  />
                </div>

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

                <div className="flex flex-wrap gap-3">
                  <Button type="submit" disabled={loading}>
                    {loading ? "Guardando…" : "Guardar receta"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={cerrar} disabled={loading}>
                    Cerrar
                  </Button>
                  {tieneReceta && !confirmandoBorrado && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setConfirmandoBorrado(true)}
                      disabled={loading}
                    >
                      Eliminar receta
                    </Button>
                  )}
                </div>

                {confirmandoBorrado && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                    <p className="text-sm text-red-800">
                      ¿Eliminar la receta de {selected.product.name}? Después de esto, producirlo
                      deja de descontar insumos y nada lo va a advertir. Si solo quieres pausarla,
                      desmarca <span className="font-medium">Receta vigente</span> y guarda: eso se
                      puede deshacer.
                    </p>
                    <div className="mt-3 flex gap-3">
                      <Button type="button" variant="danger" onClick={eliminar} disabled={loading}>
                        Sí, eliminar
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setConfirmandoBorrado(false)}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}

                <p className="text-xs text-slate-400">
                  Cambiar una receta no altera las producciones ya registradas: esas dejaron sus
                  movimientos en el historial, que no se reescribe. Solo cambia lo que descuentan las
                  producciones futuras.
                </p>
              </form>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Productos{" "}
            {variants.length > 0 && (
              <span className="text-sm font-normal text-slate-400">
                · {conReceta.length} con receta de {variants.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {variants.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">
              No hay productos activos en el catálogo. Crea al menos dos: uno para producir y otro
              que le sirva de insumo.
            </p>
          ) : sinInsumosPosibles ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">
              Hay un solo producto en el catálogo, así que todavía no hay nada que pueda usarse como
              insumo. Carga al menos un producto más —la harina, por ejemplo— y vuelve acá.
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Producto</Th>
                  <Th>Receta</Th>
                  <Th>Insumos</Th>
                  {canManage && <Th />}
                </Tr>
              </Thead>
              <Tbody>
                {variants.map((v) => (
                  <Tr key={v.id} className={v.id === selected?.id ? "bg-brand-50" : undefined}>
                    <Td>
                      {v.product.name}{" "}
                      <span className="font-mono text-xs text-slate-400">({v.sku})</span>
                    </Td>
                    <Td>
                      {!v.recipe ? (
                        <span className="text-slate-400">Sin receta</span>
                      ) : v.recipe.active ? (
                        <Badge tone="good">Rinde {formatQuantity(v.recipe.yield, v.unit)}</Badge>
                      ) : (
                        <Badge tone="warn">Desactivada</Badge>
                      )}
                    </Td>
                    <Td className="text-slate-500">
                      {v.recipe
                        ? v.recipe.items
                            .map(
                              (i) =>
                                `${i.variant.sku} ${formatQuantity(i.quantity, i.variant.unit)}`
                            )
                            .join(" · ") || "—"
                        : "—"}
                    </Td>
                    {canManage && (
                      <Td>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => editar(v)}
                          disabled={loading}
                        >
                          {v.recipe ? "Editar" : "Crear receta"}
                        </Button>
                      </Td>
                    )}
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
