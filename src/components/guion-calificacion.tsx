"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  ASUNTO_CORREO,
  LARGO_MAXIMO_WHATSAPP,
  cuerpoCorreo,
  guionCompletoEnTexto,
  mensajeWhatsApp,
  normalizarNumeroChile,
} from "@/lib/qualification";

interface Pregunta {
  id: string;
  position: number;
  block: string;
  text: string;
  reason: string;
}

type Modo = "llamada" | "whatsapp" | "correo";

// Mismas clases que el botón primario de src/components/ui/button.tsx. Acá va
// un enlace de verdad y no un <button> envuelto en <a> —que es HTML inválido—
// porque abrir WhatsApp o el correo es navegar, no ejecutar una acción.
const claseEnlaceBoton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-900";

const modos: { valor: Modo; etiqueta: string; ayuda: string }[] = [
  { valor: "llamada", etiqueta: "Leerlo yo", ayuda: "Está al teléfono o conversando: las 14 preguntas en orden." },
  { valor: "whatsapp", etiqueta: "Mandar por WhatsApp", ayuda: "Escribió y no hay tiempo de hablar: cinco preguntas en un mensaje." },
  { valor: "correo", etiqueta: "Mandar por correo", ayuda: "Lo mismo, con espacio para explicar el siguiente paso." },
];

export function GuionCalificacion({ questions }: { questions: Pregunta[] }) {
  const [modo, setModo] = useState<Modo>("llamada");
  const [marcadas, setMarcadas] = useState<Record<string, boolean>>({});
  const [copiado, setCopiado] = useState<string | null>(null);

  const [numero, setNumero] = useState("");
  const [mensaje, setMensaje] = useState(mensajeWhatsApp);

  const [correo, setCorreo] = useState("");
  const [asunto, setAsunto] = useState(ASUNTO_CORREO);
  const [cuerpo, setCuerpo] = useState(cuerpoCorreo);

  const bloques = useMemo(() => Array.from(new Set(questions.map((q) => q.block))), [questions]);
  const listas = questions.filter((q) => marcadas[q.id]).length;

  // El destinatario es opcional a propósito: cuando el cliente ya escribió, el
  // chat está abierto y wa.me sin número deja elegirlo. Un número mal escrito
  // en la URL abre un chat con un desconocido.
  const numeroLimpio = normalizarNumeroChile(numero);
  const numeroIncompleto = numero.trim().length > 0 && numeroLimpio === null;
  const largoMensaje = mensaje.length;
  const mensajeLargo = largoMensaje > LARGO_MAXIMO_WHATSAPP;

  const enlaceWhatsApp = `https://wa.me/${numeroLimpio ?? ""}?text=${encodeURIComponent(mensaje)}`;
  const enlaceCorreo = `mailto:${encodeURIComponent(correo.trim())}?subject=${encodeURIComponent(
    asunto
  )}&body=${encodeURIComponent(cuerpo)}`;

  async function copiar(texto: string, etiqueta: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(etiqueta);
      window.setTimeout(() => setCopiado(null), 2500);
    } catch {
      setCopiado("error");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Guion de calificación</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Lo que hay que averiguar antes de cotizarle a alguien. Úsalo apenas llame o escriba: acá
          nada se guarda, las respuestas van en la ficha del interesado.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {modos.map((m) => (
          <button
            key={m.valor}
            type="button"
            onClick={() => setModo(m.valor)}
            aria-pressed={modo === m.valor}
            className={cn(
              "min-h-11 rounded-md border px-4 py-2 text-sm font-medium transition-colors",
              modo === m.valor
                ? "border-brand-700 bg-brand-700 text-white"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            )}
          >
            {m.etiqueta}
          </button>
        ))}
      </div>
      <p className="-mt-3 text-xs text-slate-500">{modos.find((m) => m.valor === modo)?.ayuda}</p>

      {copiado === "error" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          El navegador no dejó copiar. Selecciona el texto y cópialo a mano.
        </p>
      )}
      {copiado && copiado !== "error" && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{copiado}</p>
      )}

      {modo === "llamada" && (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Las 14 preguntas, en orden</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                {listas} de {questions.length} marcadas. Las marcas son solo para no perderte: se
                borran al salir.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {listas > 0 && (
                <Button variant="ghost" onClick={() => setMarcadas({})}>
                  Empezar de nuevo
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => copiar(guionCompletoEnTexto(questions), "Guion copiado.")}
              >
                Copiar el guion
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {questions.length === 0 && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                No hay preguntas cargadas en la base. Se reponen con{" "}
                <code className="rounded bg-amber-100 px-1">npm run db:seed:preguntas</code>.
              </p>
            )}
            {bloques.map((bloque) => (
              <div key={bloque}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-700">
                  {bloque}
                </p>
                <ul className="space-y-2">
                  {questions
                    .filter((q) => q.block === bloque)
                    .map((q) => (
                      <li key={q.id}>
                        <label
                          className={cn(
                            "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors",
                            marcadas[q.id]
                              ? "border-slate-200 bg-slate-50"
                              : "border-slate-200 bg-white hover:border-brand-500"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(marcadas[q.id])}
                            onChange={(e) =>
                              setMarcadas((prev) => ({ ...prev, [q.id]: e.target.checked }))
                            }
                            className="mt-1 h-5 w-5 flex-shrink-0 rounded border-slate-300 text-brand-700 focus:ring-brand-500"
                          />
                          <span>
                            <span
                              className={cn(
                                "block text-base text-slate-900",
                                marcadas[q.id] && "text-slate-400 line-through"
                              )}
                            >
                              {q.position}. {q.text}
                            </span>
                            <span className="mt-1 block text-xs text-slate-400">{q.reason}</span>
                          </span>
                        </label>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
            <p className="border-t border-slate-200 pt-4 text-sm text-slate-500">
              Para dejar las respuestas escritas, abre o crea la ficha en{" "}
              <Link href="/customers" className="font-medium text-brand-700 hover:underline">
                Clientes
              </Link>{" "}
              y usa el guion de ahí.
            </p>
          </CardContent>
        </Card>
      )}

      {modo === "whatsapp" && (
        <Card>
          <CardHeader>
            <CardTitle>Mensaje de WhatsApp</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              Cinco preguntas: las que se pueden contestar escribiendo. El presupuesto, quién decide
              y el recorrido completo del cliente se preguntan hablando.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="numero">Número (opcional)</Label>
              <Input
                id="numero"
                inputMode="tel"
                placeholder="+56 9 1234 5678"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                className="mt-1"
              />
              <p className="mt-1 text-xs text-slate-500">
                {numeroIncompleto
                  ? "Ese número no está completo. Déjalo vacío y eliges el chat en WhatsApp."
                  : "Si ya te escribió, déjalo vacío: WhatsApp te deja elegir la conversación."}
              </p>
            </div>
            <div>
              <Label htmlFor="mensaje">Mensaje</Label>
              <textarea
                id="mensaje"
                rows={14}
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <p className={cn("mt-1 text-xs", mensajeLargo ? "text-amber-700" : "text-slate-500")}>
                {largoMensaje} de {LARGO_MAXIMO_WHATSAPP} caracteres.{" "}
                {mensajeLargo
                  ? "Pasado ese largo el enlace puede llegar cortado: acórtalo o mándalo en dos mensajes."
                  : "El texto viaja dentro del enlace, así que el largo importa."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={enlaceWhatsApp}
                target="_blank"
                rel="noopener noreferrer"
                className={claseEnlaceBoton}
              >
                {numeroLimpio ? "Abrir el chat" : "Abrir WhatsApp"}
              </a>
              <Button variant="secondary" onClick={() => copiar(mensaje, "Mensaje copiado.")}>
                Copiar el mensaje
              </Button>
              <Button variant="ghost" onClick={() => setMensaje(mensajeWhatsApp())}>
                Volver al texto original
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {modo === "correo" && (
        <Card>
          <CardHeader>
            <CardTitle>Correo</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              Se abre tu programa de correo con todo escrito. Sale desde tu cuenta, así que queda en
              Enviados y la respuesta te llega a ti.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="correo">Correo del interesado</Label>
              <Input
                id="correo"
                type="email"
                inputMode="email"
                placeholder="nombre@sunegocio.cl"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="asunto">Asunto</Label>
              <Input
                id="asunto"
                value={asunto}
                onChange={(e) => setAsunto(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="cuerpo">Mensaje</Label>
              <textarea
                id="cuerpo"
                rows={18}
                value={cuerpo}
                onChange={(e) => setCuerpo(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={enlaceCorreo} className={claseEnlaceBoton}>
                Abrir el correo
              </a>
              <Button
                variant="secondary"
                onClick={() => copiar(`${asunto}\n\n${cuerpo}`, "Correo copiado.")}
              >
                Copiar asunto y mensaje
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setAsunto(ASUNTO_CORREO);
                  setCuerpo(cuerpoCorreo());
                }}
              >
                Volver al texto original
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
