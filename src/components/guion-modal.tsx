"use client";

import { useEffect, useMemo, useState } from "react";
import { mensajeChat } from "@/lib/qualification";

interface Pregunta {
  id: string;
  position: number;
  block: string;
  text: string;
  reason: string;
}

export interface ContactoGuion {
  wa_id: string;
  nombre: string | null;
  negocio: string | null;
  necesidad: string | null;
  resumen: string | null;
  servicio_probable: string | null;
}

/**
 * El guion de calificación sobre la conversación, sin salir de la bandeja.
 *
 * Sirve para dos momentos distintos del mismo rato: ir anotando mientras se
 * habla por teléfono, y mandarle por escrito las cinco que se pueden contestar
 * tecleando. Lo que se escribe acá se guarda en la ficha del interesado; si
 * todavía no tiene ficha, se crea con la misma ruta que usa "Pasar a Clientes",
 * que busca por teléfono y no duplica.
 */
export function GuionModal({
  contacto,
  onUsarEnRespuesta,
  onCerrar,
}: {
  contacto: ContactoGuion;
  onUsarEnRespuesta: ((texto: string) => void) | null;
  onCerrar: () => void;
}) {
  const [preguntas, setPreguntas] = useState<Pregunta[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [clienteNombre, setClienteNombre] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  // Escape cierra, como cualquier ventana emergente. Y mientras está abierta el
  // fondo no se desplaza: si no, al hacer scroll dentro del guion se mueve la
  // bandeja de atrás y uno pierde el hilo.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    document.addEventListener("keydown", alTeclear);
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", alTeclear);
      document.body.style.overflow = overflowPrevio;
    };
  }, [onCerrar]);

  useEffect(() => {
    let vigente = true;
    (async () => {
      try {
        const res = await fetch(`/api/qualification?wa_id=${encodeURIComponent(contacto.wa_id)}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo cargar el guion");
        if (!vigente) return;
        setPreguntas(data.questions);
        setClienteId(data.customer?.id ?? null);
        setClienteNombre(data.customer?.name ?? null);
        setValues(
          Object.fromEntries(
            (data.answers as { questionId: string; answer: string }[]).map((a) => [
              a.questionId,
              a.answer,
            ])
          )
        );
      } catch (e) {
        if (vigente) setError((e as Error).message);
      } finally {
        if (vigente) setCargando(false);
      }
    })();
    return () => {
      vigente = false;
    };
  }, [contacto.wa_id]);

  const bloques = useMemo(
    () => Array.from(new Set(preguntas.map((p) => p.block))),
    [preguntas]
  );
  const respondidas = preguntas.filter((p) => (values[p.id] ?? "").trim().length > 0).length;

  async function guardar() {
    setGuardando(true);
    setError("");
    setAviso("");
    try {
      let id = clienteId;
      if (!id) {
        // Misma ruta que "Pasar a Clientes": es idempotente, así que si la ficha
        // apareció entremedio devuelve esa en vez de crear una segunda.
        const res = await fetch("/api/whatsapp/customer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            wa_id: contacto.wa_id,
            name: contacto.nombre,
            business_name: contacto.negocio,
            need: contacto.necesidad,
            summary: contacto.resumen,
            probable_service: contacto.servicio_probable,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo crear la ficha");
        id = data.id as string;
        setClienteId(id);
        setClienteNombre(data.nombre as string);
      }

      const res = await fetch(`/api/customers/${id}/answers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: preguntas.map((p) => ({ questionId: p.id, answer: values[p.id] ?? "" })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "No se pudieron guardar las respuestas");
      setAviso(`Guardado en la ficha. ${data.respondidas} de ${preguntas.length} respondidas.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Cerrar el guion"
        onClick={onCerrar}
        className="absolute inset-0 bg-slate-900/50"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="guion-titulo"
        className="relative flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-xl sm:max-h-[85vh] sm:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b p-4">
          <div className="min-w-0">
            <h2 id="guion-titulo" className="text-lg font-semibold text-slate-900">
              Guion de calificación
            </h2>
            <p className="mt-0.5 truncate text-sm text-slate-500">
              {clienteNombre
                ? `Se guarda en la ficha de ${clienteNombre}.`
                : "Todavía no tiene ficha en Clientes: se crea al guardar."}
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="shrink-0 rounded-lg border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Cerrar
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error && (
            <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          )}
          {aviso && (
            <p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
              {aviso}
            </p>
          )}

          {cargando && <p className="py-10 text-center text-sm text-slate-500">Cargando el guion…</p>}

          {!cargando && preguntas.length === 0 && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              No hay preguntas cargadas en la base. Se reponen con{" "}
              <code className="rounded bg-amber-100 px-1">npm run db:seed:preguntas</code>.
            </p>
          )}

          {!cargando && preguntas.length > 0 && (
            <>
              <p className="mb-3 text-xs text-slate-500">
                {respondidas} de {preguntas.length} respondidas. Anota mientras conversas: lo que
                escribas queda en la ficha del interesado.
              </p>
              <div className="space-y-5">
                {bloques.map((bloque) => (
                  <div key={bloque}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                      {bloque}
                    </p>
                    <ol className="space-y-3">
                      {preguntas
                        .filter((p) => p.block === bloque)
                        .map((p) => (
                          <li key={p.id} className="rounded-lg border border-slate-200 p-3">
                            <label
                              htmlFor={`guion-${p.id}`}
                              className="block text-sm font-medium text-slate-800"
                            >
                              {p.position}. {p.text}
                            </label>
                            <p className="mt-1 text-xs text-slate-400">{p.reason}</p>
                            <textarea
                              id={`guion-${p.id}`}
                              rows={2}
                              value={values[p.id] ?? ""}
                              onChange={(e) =>
                                setValues((prev) => ({ ...prev, [p.id]: e.target.value }))
                              }
                              placeholder="Respuesta del interesado"
                              className="mt-2 w-full rounded-lg border p-2 text-sm"
                            />
                          </li>
                        ))}
                    </ol>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t p-4">
          <button
            type="button"
            disabled={!onUsarEnRespuesta}
            onClick={() => {
              onUsarEnRespuesta?.(mensajeChat());
              onCerrar();
            }}
            title={
              onUsarEnRespuesta
                ? "Deja las cinco preguntas escritas en el cuadro de respuesta. No se envía solo."
                : "La ventana de 24 horas terminó: no se puede escribir en esta conversación."
            }
            className="rounded-lg border px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Mandarle las 5 preguntas
          </button>
          <button
            type="button"
            disabled={guardando || cargando || preguntas.length === 0}
            onClick={() => void guardar()}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {guardando
              ? "Guardando…"
              : clienteId
                ? "Guardar en la ficha"
                : "Crear ficha y guardar"}
          </button>
        </footer>
      </div>
    </div>
  );
}
