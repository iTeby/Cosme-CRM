"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface QuestionRow {
  id: string;
  position: number;
  block: string;
  text: string;
  reason: string;
}

export interface AnswerRow {
  questionId: string;
  answer: string;
}

// El guion de calificación: las mismas 14 preguntas para todo interesado, en
// orden, con el motivo de cada una para que quien las haga entienda qué está
// averiguando. Las respuestas se guardan junto al cliente.
export function QualificationScript({
  customerId,
  questions,
  answers,
  canManage,
}: {
  customerId: string;
  questions: QuestionRow[];
  answers: AnswerRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const inicial = Object.fromEntries(answers.map((a) => [a.questionId, a.answer]));
  const [values, setValues] = useState<Record<string, string>>(inicial);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const respondidas = questions.filter((q) => (values[q.id] ?? "").trim().length > 0).length;
  const bloques = Array.from(new Set(questions.map((q) => q.block)));

  async function guardar() {
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/customers/${customerId}/answers`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: questions.map((q) => ({ questionId: q.id, answer: values[q.id] ?? "" })),
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudieron guardar las respuestas.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Guion de calificación</CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            {respondidas} de {questions.length} respondidas. Se hace por WhatsApp, en orden, apenas
            alguien escribe.{" "}
            <Link href="/guion" className="font-medium text-brand-700 hover:underline">
              Mandárselas por WhatsApp o correo
            </Link>
          </p>
        </div>
        {canManage && !editing && (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {respondidas === 0 ? "Aplicar guion" : "Editar respuestas"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {bloques.map((bloque) => (
          <div key={bloque}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-700">{bloque}</p>
            <ol className="space-y-3">
              {questions
                .filter((q) => q.block === bloque)
                .map((q) => (
                  <li key={q.id} className="rounded-lg border border-slate-200 p-3">
                    <p className="text-sm font-medium text-slate-800">
                      {q.position}. {q.text}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">{q.reason}</p>
                    {editing ? (
                      <textarea
                        className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        rows={2}
                        value={values[q.id] ?? ""}
                        onChange={(e) => setValues((prev) => ({ ...prev, [q.id]: e.target.value }))}
                        placeholder="Respuesta del interesado"
                      />
                    ) : (
                      <p className="mt-2 whitespace-pre-line text-sm text-slate-700">
                        {(values[q.id] ?? "").trim() || <span className="text-slate-300">Sin responder</span>}
                      </p>
                    )}
                  </li>
                ))}
            </ol>
          </div>
        ))}
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {editing && (
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => { setValues(inicial); setEditing(false); }} disabled={loading}>
              Cancelar
            </Button>
            <Button onClick={guardar} disabled={loading}>
              {loading ? "Guardando…" : "Guardar respuestas"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
