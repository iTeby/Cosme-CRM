"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Contact = { wa_id: string; declared_name: string | null; profile_name: string | null; need: string | null; status: string; summary?: string; last_inbound_at: string };
type Detail = { contact: Contact; canReply: boolean; messages: { message_id: string; direction: string; body: string; recorded_at: string }[]; summary: { summary: string; next_action: string; missing_information: string } | null };
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
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const gen = ++generation.current;
    try {
      const [list, current] = await Promise.all([api(), selected ? api(`/${selected}`) : Promise.resolve(null)]);
      if (gen !== generation.current) return;
      setContacts(list.contacts); setDetail(current); setError(""); setLoaded(true);
    } catch (e) { if (gen === generation.current) { setError((e as Error).message); setLoaded(true); } }
  }, [selected]);
  useEffect(() => {
    setDetail(null); void reload();
    const tick = setInterval(() => { if (!document.hidden) void reload(); }, 30000);
    return () => { clearInterval(tick); generation.current++; };
  }, [reload]);
  async function action(action: string) {
    const id = selected;
    setBusy(true); setNotice(""); setError("");
    try {
      await api(`/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, message: drafts[id] || "" }) });
      if (action === "reply") setDrafts(old => ({ ...old, [id]: "" }));
      setNotice(action === "reply" ? "Respuesta aceptada por WhatsApp." : action === "take" ? "Conversación a tu cargo. El bot queda pausado." : "Resumen actualizado.");
      await reload();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const visible = contacts.filter(c => `${name(c)} ${c.wa_id} ${c.need || ""}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold text-slate-900">WhatsApp</h1><p className="text-sm text-slate-500">Conversaciones de Cosme · Actualización cada 30 segundos</p></div><button onClick={() => void reload()} className="rounded-lg border bg-white px-4 py-2 text-sm">Actualizar</button></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{notice}</p>}
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="rounded-xl border bg-white p-3"><label className="text-sm font-medium" htmlFor="wa-search">Buscar conversaciones</label><input id="wa-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Nombre, teléfono o necesidad" className="mb-3 mt-2 w-full rounded-lg border p-2 text-sm" /><p className="mb-2 text-xs text-slate-500">{contacts.length} conversaciones · {contacts.filter(c => c.status === "NUEVO").length} nuevas</p><div className="max-h-[65vh] space-y-2 overflow-y-auto">{visible.map(c => <button key={c.wa_id} disabled={busy} onClick={() => { setSelected(c.wa_id); setNotice(""); }} aria-pressed={selected === c.wa_id} className={`w-full rounded-lg border p-3 text-left ${selected === c.wa_id ? "border-emerald-600 bg-emerald-50" : "border-slate-100 hover:bg-slate-50"}`}><strong className="block truncate">{name(c)}</strong><span className="block text-xs text-slate-500">{c.status.replaceAll("_", " ")} · {date(c.last_inbound_at)}</span><span className="mt-1 block truncate text-sm text-slate-600">{c.summary || c.need || "Sin resumen todavía"}</span></button>)}{!visible.length && <p className="p-3 text-sm text-slate-500">{loaded ? "No hay conversaciones para mostrar." : "Cargando…"}</p>}</div></aside>
      <section className="min-w-0 rounded-xl border bg-white p-4">{!detail ? <p className="py-20 text-center text-slate-500">{selected ? "Cargando conversación…" : "Selecciona una conversación para responder."}</p> : <>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{name(detail.contact)}</h2><p className="text-sm text-slate-500">+{detail.contact.wa_id} · {detail.contact.status.replaceAll("_", " ")}</p></div><button disabled={busy} onClick={() => void action("take")} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">Tomar conversación</button></div>
        <div className="my-4 rounded-lg bg-slate-50 p-3"><div className="flex items-center justify-between gap-2"><strong className="text-sm">Resumen del cliente</strong><button disabled={busy} onClick={() => void action("summary")} className="text-xs text-emerald-700">Actualizar resumen</button></div><p className="mt-2 text-sm">{detail.summary?.summary || "Sin resumen todavía."}</p>{detail.summary && <p className="mt-2 text-xs text-slate-500">Siguiente paso: {detail.summary.next_action}<br />Por confirmar: {detail.summary.missing_information}</p>}</div>
        <div className="max-h-[45vh] space-y-3 overflow-y-auto rounded-lg border p-3">{detail.messages.map(m => <div key={m.message_id} className={`max-w-[90%] rounded-xl p-3 ${m.direction === "SALIENTE" ? "ml-auto bg-emerald-50" : "bg-slate-100"}`}><p className="whitespace-pre-wrap break-words text-sm">{m.body}</p><p className="mt-1 text-[11px] text-slate-500">{m.direction === "SALIENTE" ? "Cosme" : "Cliente"} · {date(m.recorded_at)}</p></div>)}</div>
        <form className="mt-4 space-y-2" onSubmit={e => { e.preventDefault(); if (!busy) void action("reply"); }}><label htmlFor="wa-reply" className="text-sm font-medium">Responder desde Cosme</label><textarea id="wa-reply" value={drafts[selected] || ""} onChange={e => setDrafts(old => ({ ...old, [selected]: e.target.value }))} maxLength={900} rows={3} disabled={busy || !detail.canReply} placeholder="Escribe tu respuesta…" className="w-full rounded-lg border p-3 text-sm disabled:bg-slate-50" /><div className="flex items-center justify-between gap-3"><p className="text-xs text-slate-500">{detail.canReply ? "Al responder, el bot se pausa para esta conversación." : "La ventana de 24 horas terminó. Espera un mensaje del cliente o utiliza una plantilla aprobada desde el panel correspondiente."}</p><button disabled={busy || !detail.canReply || !(drafts[selected] || "").trim()} className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? "Procesando…" : "Enviar"}</button></div></form>
      </>}</section>
    </div>
  </div>;
}
