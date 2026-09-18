"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Contact = { wa_id: string; declared_name: string | null; profile_name: string | null; need: string | null; business_name?: string | null; status: string; summary?: string; probable_service?: string | null; urgency?: string | null; last_inbound_at: string; window_minutes_left?: number; can_reply?: boolean; ultimo_mensaje?: string | null; requested_human_at?: string | null };

// "Sin leer" no existe en WhatsApp Cloud API, así que se define con lo que sí
// se sabe: el cliente escribió después de que tomaste la conversación, o nunca
// la tomaste. Eso es exactamente lo que hay que mirar primero.
const sinLeer = (c: Contact) => {
  const tomada = Date.parse(c.requested_human_at ?? "");
  const escrito = Date.parse(c.last_inbound_at);
  if (!Number.isFinite(escrito)) return false;
  return !Number.isFinite(tomada) || escrito > tomada;
};
type Metricas = {
  resumen: { contactos_total: number; nuevos_30d: number; nuevos_30d_previos: number; tasa_conversacion: number; tasa_derivacion: number; ventanas_por_vencer: number; ventanas_vencidas_sin_respuesta: number; mensajes_por_contacto: number };
  perdidas: { wa_id: string; negocio: string | null; necesidad: string | null; dias: number }[];
  salud: { alertas_fallidas: number; sheets_pendientes: number; resumenes_generados: number };
};
const URGENCIAS: Record<string, number> = { alta: 0, media: 1, baja: 2 };
const VACIOS = ["por definir", "sin determinar", "no informado", "desconocido", "-", ""];
const util = (v?: string | null) => (v && !VACIOS.includes(v.trim().toLowerCase()) ? v.trim() : null);
const corto = (v: string, max = 42) => (v.length > max ? `${v.slice(0, max - 1)}…` : v);
const reloj = (min?: number) => {
  if (min === undefined || min <= 0) return null;
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${String(min % 60).padStart(2, "0")} m` : `${min} m`;
};
type Detail = { contact: Contact; canReply: boolean; messages: { message_id: string; direction: string; body: string; recorded_at: string }[]; summary: { summary: string; next_action: string; missing_information: string; probable_service?: string; urgency?: string; updated_at?: string } | null };

// Aperturas que se usan a diario. El texto queda en el cuadro para editarlo
// antes de enviar: nunca se manda solo por apretar el botón.
const RAPIDAS: { rotulo: string; texto: string }[] = [
  { rotulo: "Demo de agenda", texto: "Te dejo el demo funcionando para que lo pruebes: https://vitalis.cosmespa.cl · Entra como si fueras tu propio cliente y pide una hora. El panel del dueño está en /panel/entrar con la clave demo1234." },
  { rotulo: "Demo de pedidos", texto: "Te dejo el demo de pedidos para que lo pruebes: https://pedidos.cosmespa.cl · Arma un pedido como lo haría un cliente tuyo. El panel del dueño está en /panel/entrar con la clave demo1234." },
  { rotulo: "Pedir rubro y tamaño", texto: "Para orientarte con un número realista necesito dos datos: ¿de qué rubro es tu negocio y cuántas personas atienden?" },
  { rotulo: "Proponer llamada", texto: "¿Te sirve que lo veamos en una llamada corta de 15 minutos? Dime qué día y hora te acomoda y te llamo." },
];
const name = (c: Contact) => c.declared_name || c.profile_name || `+${c.wa_id}`;
const date = (s: string) => new Date(s).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });

async function api(path = "", init?: RequestInit) {
  const res = await fetch(`/api/whatsapp${path}`, { ...init, cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "No se pudo cargar WhatsApp");
  return data;
}

export function WhatsAppInbox() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  // Dos vistas y no una. "No es un prospecto" escondía para siempre y no había
  // forma de revertirlo desde ninguna pantalla: la acción de restaurar existía en
  // el Worker desde el principio, pero no había botón que llegara a ella.
  const [vista, setVista] = useState<"bandeja" | "archivadas">("bandeja");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [vinculando, setVinculando] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const gen = ++generation.current;
    try {
      // Las métricas no bloquean la bandeja: si el endpoint falla, la lista se
      // muestra igual y solo desaparece la tira de arriba.
      const [list, current, stats] = await Promise.all([
        api(vista === "archivadas" ? "?archivadas=1" : ""),
        selected ? api(`/${selected}`) : Promise.resolve(null),
        api("/metricas").catch(() => null),
      ]);
      if (gen !== generation.current) return;
      setContacts(list.contacts); setDetail(current); setMetricas(stats); setError(""); setLoaded(true);
    } catch (e) { if (gen === generation.current) { setError((e as Error).message); setLoaded(true); } }
  }, [selected, vista]);
  useEffect(() => {
    setDetail(null); void reload();
    const tick = setInterval(() => { if (!document.hidden) void reload(); }, 30000);
    return () => { clearInterval(tick); generation.current++; };
  }, [reload]);
  async function action(action: string, waId?: string) {
    const id = waId ?? selected;
    setBusy(true); setNotice(""); setError("");
    try {
      await api(`/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, message: drafts[id] || "" }) });
      if (action === "reply") setDrafts(old => ({ ...old, [id]: "" }));
      setNotice(action === "reply" ? "Respuesta aceptada por WhatsApp."
        : action === "take" ? "Conversación a tu cargo. El bot queda pausado."
        : action === "ocultar" ? "Archivada. Está en la pestaña Archivadas y vuelve sola si la persona escribe de nuevo."
        : action === "mostrar" ? "De vuelta en la bandeja."
        : "Resumen actualizado.");
      await reload();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  // Antes ordenaba por fecha del último mensaje. Ahora manda la ventana de 24 h:
  // primero lo que se cierra pronto, y a igualdad de plazo, la urgencia de la IA.
  async function aCliente(cotizar: boolean) {
    if (!detail) return;
    setVinculando(true); setError(""); setNotice("");
    try {
      const res = await fetch("/api/whatsapp/customer", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({
          wa_id: detail.contact.wa_id,
          name: detail.contact.declared_name || detail.contact.profile_name,
          business_name: detail.contact.business_name,
          need: detail.contact.need,
          summary: detail.summary?.summary,
          probable_service: detail.summary?.probable_service,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo crear el cliente");
      if (cotizar) { window.location.href = `/quotes/new?customerId=${data.id}`; return; }
      setNotice(data.creado ? `${data.nombre} quedó en Clientes, etapa Calificado.` : `${data.nombre} ya estaba en Clientes.`);
    } catch (e) { setError((e as Error).message); }
    finally { setVinculando(false); }
  }

  async function archivarCerradas() {
    const cerradas = contacts.filter(c => !c.can_reply);
    if (!cerradas.length) return;
    if (!confirm(`Archivar ${cerradas.length} ${cerradas.length === 1 ? "conversación cerrada" : "conversaciones cerradas"}. Quedan en la pestaña Archivadas y vuelven solas si la persona escribe. ¿Seguir?`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      for (const c of cerradas) {
        await api(`/${c.wa_id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ocultar", message: "Cerrada y archivada en lote desde el CRM" }) });
      }
      setSelected("");
      setNotice(`${cerradas.length} ${cerradas.length === 1 ? "conversación archivada" : "conversaciones archivadas"}.`);
      await reload();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const visible = contacts
    .filter(c => `${name(c)} ${c.wa_id} ${c.need || ""} ${c.business_name || ""} ${c.probable_service || ""}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const abierta = (c: Contact) => (c.can_reply ? 0 : 1);
      if (abierta(a) !== abierta(b)) return abierta(a) - abierta(b);
      // Lo que no has leído va arriba de todo dentro de las conversaciones vivas.
      if (a.can_reply && b.can_reply && sinLeer(a) !== sinLeer(b)) return sinLeer(a) ? -1 : 1;
      const u = (c: Contact) => URGENCIAS[(c.urgency || "").toLowerCase()] ?? 1;
      if (a.can_reply && b.can_reply) {
        const dif = (a.window_minutes_left ?? 0) - (b.window_minutes_left ?? 0);
        if (Math.abs(dif) > 60) return dif;
        return u(a) - u(b);
      }
      return Date.parse(b.last_inbound_at) - Date.parse(a.last_inbound_at);
    });
  const urgentes = visible.filter(c => c.can_reply && (c.window_minutes_left ?? 0) < 240).length;
  const pendientes = visible.filter(c => c.can_reply && sinLeer(c)).length;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold text-slate-900">WhatsApp</h1><p className="text-sm text-slate-500">Conversaciones de Cosme · Actualización cada 30 segundos</p></div><button onClick={() => void reload()} className="rounded-lg border bg-white px-4 py-2 text-sm">Actualizar</button></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{notice}</p>}
    {metricas && <section aria-label="Resumen de la operación" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-slate-200 sm:grid-cols-3 lg:grid-cols-6">
      {[
        { n: metricas.resumen.ventanas_por_vencer, t: "Se cierran en 4 h", ojo: metricas.resumen.ventanas_por_vencer > 0 },
        { n: metricas.resumen.ventanas_vencidas_sin_respuesta, t: "Vencidas sin responder", ojo: metricas.resumen.ventanas_vencidas_sin_respuesta > 0 },
        { n: metricas.resumen.nuevos_30d, t: "Nuevos en 30 días" },
        { n: `${metricas.resumen.tasa_conversacion}%`, t: "Pasan del hola" },
        { n: `${metricas.resumen.tasa_derivacion}%`, t: "Piden hablar contigo" },
        { n: metricas.salud.alertas_fallidas, t: "Alertas sin llegar", ojo: metricas.salud.alertas_fallidas > 0 },
      ].map(k => <div key={k.t} className="bg-white p-3">
        <b className={`block text-xl font-semibold tabular-nums ${k.ojo ? "text-red-700" : "text-slate-900"}`}>{k.n}</b>
        <span className="text-xs text-slate-500">{k.t}</span>
      </div>)}
    </section>}

    {metricas && metricas.perdidas.length > 0 && <details className="rounded-xl border bg-amber-50 p-3 text-amber-900">
      <summary className="cursor-pointer text-sm font-medium">
        {metricas.perdidas.length} {metricas.perdidas.length === 1 ? "conversación se cerró" : "conversaciones se cerraron"} sin que alcanzaras a responder
      </summary>
      <ul className="mt-2 space-y-1 text-sm">
        {metricas.perdidas.map(p => <li key={p.wa_id}>
          {p.negocio || `+${p.wa_id}`} · {p.necesidad || "sin necesidad informada"} · hace {p.dias} {p.dias === 1 ? "día" : "días"}
        </li>)}
      </ul>
      <p className="mt-2 text-xs">La ventana de WhatsApp dura 24 horas desde el último mensaje del cliente. Pasado ese plazo hace falta una plantilla aprobada, y esa sí se cobra.</p>
    </details>}

    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="rounded-xl border bg-white p-3">
        <div role="tablist" aria-label="Vista de conversaciones" className="mb-3 flex gap-1 rounded-lg bg-slate-100 p-1">
          {([["bandeja", "Bandeja"], ["archivadas", "Archivadas"]] as const).map(([clave, rotulo]) =>
            <button key={clave} role="tab" aria-selected={vista === clave} disabled={busy}
              onClick={() => { if (vista !== clave) { setVista(clave); setSelected(""); setNotice(""); } }}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm ${vista === clave ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>{rotulo}</button>)}
        </div>
        <label className="text-sm font-medium" htmlFor="wa-search">Buscar conversaciones</label><input id="wa-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Nombre, teléfono o necesidad" className="mb-3 mt-2 w-full rounded-lg border p-2 text-sm" /><p className="mb-2 text-xs text-slate-500">{contacts.length} conversaciones{pendientes > 0 && <> · <span className="font-semibold text-emerald-700">{pendientes} sin leer</span></>}{urgentes > 0 && <> · <span className="font-semibold text-red-700">{urgentes} por vencer</span></>}</p>
        {vista === "bandeja" && contacts.some(c => !c.can_reply) && <button disabled={busy} onClick={() => void archivarCerradas()} className="mb-2 w-full rounded-lg border border-dashed px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">Archivar las {contacts.filter(c => !c.can_reply).length} cerradas</button>}<div className="max-h-[65vh] space-y-2 overflow-y-auto">{visible.map(c => <button key={c.wa_id} disabled={busy} onClick={() => { setSelected(c.wa_id); setNotice(""); }} aria-pressed={selected === c.wa_id} className={`w-full rounded-lg border p-3 text-left ${selected === c.wa_id ? "border-emerald-600 bg-emerald-50" : "border-slate-100 hover:bg-slate-50"}`}><span className="flex items-baseline justify-between gap-2"><strong className={`truncate ${vista === "bandeja" && c.can_reply && sinLeer(c) ? "font-bold text-slate-900" : ""}`}>{vista === "bandeja" && c.can_reply && sinLeer(c) && <span aria-label="Sin leer" title="Te escribieron y todavía no respondes" className="mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-600 align-middle" />}{name(c)}</strong>{c.can_reply
  ? <span className={`shrink-0 text-xs font-semibold tabular-nums ${(c.window_minutes_left ?? 0) < 240 ? "text-red-700" : "text-slate-500"}`}>{reloj(c.window_minutes_left)}</span>
  : <span className="shrink-0 text-xs text-slate-400">cerrada</span>}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{[util(c.business_name) && corto(util(c.business_name)!), util(c.probable_service)].filter(Boolean).join(" · ") || c.status.replaceAll("_", " ")}{c.urgency?.toLowerCase() === "alta" ? <span className="ml-1 font-semibold text-red-700">urgente</span> : null}</span><span className="mt-1 block truncate text-sm text-slate-700">{c.ultimo_mensaje ? <><span className="text-slate-400">Cliente: </span>{c.ultimo_mensaje}</> : (c.summary || c.need || "Sin mensajes todavía")}</span>{c.ultimo_mensaje && (c.summary || c.need) && <span className="mt-0.5 block truncate text-xs text-slate-400">{c.summary || c.need}</span>}</button>)}{!visible.length && <p className="p-3 text-sm text-slate-500">{!loaded ? "Cargando…" : vista === "archivadas" ? "No hay conversaciones archivadas." : "No hay conversaciones para mostrar."}</p>}</div></aside>
      <section className="min-w-0 rounded-xl border bg-white p-4">{!detail ? <p className="py-20 text-center text-slate-500">{selected ? "Cargando conversación…" : "Selecciona una conversación para responder."}</p> : <>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{name(detail.contact)}</h2><p className="text-sm text-slate-500">+{detail.contact.wa_id} · {detail.contact.status.replaceAll("_", " ")}</p></div><div className="flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => void action("take")} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">Tomar conversación</button>
          <button disabled={busy || vinculando} onClick={() => void aCliente(false)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{vinculando ? "Guardando…" : "Pasar a Clientes"}</button>
          <button disabled={busy || vinculando} onClick={() => void aCliente(true)} className="rounded-lg border border-emerald-700 px-3 py-2 text-sm text-emerald-800 disabled:opacity-50">Crear cotización</button>
          {vista === "bandeja"
            ? <button disabled={busy} onClick={() => { if (confirm("Archivar esta conversación. No se borra nada: queda en la pestaña Archivadas y vuelve sola a la bandeja si la persona escribe de nuevo. ¿Seguir?")) { setSelected(""); void action("ocultar"); } }} className="rounded-lg border px-3 py-2 text-sm text-slate-500 disabled:opacity-50">Archivar</button>
            : <button disabled={busy} onClick={() => { setSelected(""); void action("mostrar"); }} className="rounded-lg border border-emerald-700 px-3 py-2 text-sm text-emerald-800 disabled:opacity-50">Devolver a la bandeja</button>}
        </div></div>
        <div className="my-4 rounded-lg bg-slate-50 p-3"><div className="flex items-center justify-between gap-2"><strong className="text-sm">Resumen del cliente</strong><button disabled={busy} onClick={() => void action("summary")} className="text-xs text-emerald-700">Actualizar resumen</button></div><p className="mt-2 text-sm">{detail.summary?.summary || "Sin resumen todavía."}</p>{detail.summary && <>
          {(util(detail.summary.probable_service) || util(detail.summary.urgency)) && <p className="mt-2 flex flex-wrap gap-2 text-xs">
            {util(detail.summary.probable_service) && <span className="rounded border bg-white px-2 py-1 text-slate-700">Servicio probable: <b>{detail.summary.probable_service}</b></span>}
            {util(detail.summary.urgency) && <span className={`rounded border px-2 py-1 ${detail.summary.urgency?.toLowerCase() === "alta" ? "border-red-200 bg-red-50 text-red-800" : "bg-white text-slate-700"}`}>Urgencia: <b>{detail.summary.urgency}</b></span>}
          </p>}
          <p className="mt-2 text-xs text-slate-500">Siguiente paso: {detail.summary.next_action}<br />Por confirmar: {detail.summary.missing_information}</p>
        </>}</div>
        <div className="max-h-[45vh] space-y-3 overflow-y-auto rounded-lg border p-3">{detail.messages.map(m => <div key={m.message_id} className={`max-w-[90%] rounded-xl p-3 ${m.direction === "SALIENTE" ? "ml-auto bg-emerald-50" : "bg-slate-100"}`}><p className="whitespace-pre-wrap break-words text-sm">{m.body}</p><p className="mt-1 text-[11px] text-slate-500">{m.direction === "SALIENTE" ? "Cosme" : "Cliente"} · {date(m.recorded_at)}</p></div>)}</div>
        <form className="mt-4 space-y-2" onSubmit={e => { e.preventDefault(); if (!busy) void action("reply"); }}><label htmlFor="wa-reply" className="text-sm font-medium">Responder desde Cosme</label>
          {detail.canReply && <div className="flex flex-wrap gap-2">{RAPIDAS.map(r => <button key={r.rotulo} type="button" disabled={busy} onClick={() => setDrafts(old => ({ ...old, [selected]: r.texto }))} className="rounded-lg border px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">{r.rotulo}</button>)}</div>}<textarea id="wa-reply" value={drafts[selected] || ""} onChange={e => setDrafts(old => ({ ...old, [selected]: e.target.value }))} maxLength={900} rows={3} disabled={busy || !detail.canReply} placeholder="Escribe tu respuesta…" className="w-full rounded-lg border p-3 text-sm disabled:bg-slate-50" /><div className="flex items-center justify-between gap-3"><p className="text-xs text-slate-500">{detail.canReply ? "Al responder, el bot se pausa para esta conversación." : "La ventana de 24 horas terminó. Espera un mensaje del cliente o utiliza una plantilla aprobada desde el panel correspondiente."}</p><button disabled={busy || !detail.canReply || !(drafts[selected] || "").trim()} className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? "Procesando…" : "Enviar"}</button></div></form>
      </>}</section>
    </div>
  </div>;
}
