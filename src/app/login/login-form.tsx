"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    // Distinguir los dos casos no es un lujo: cuando el CRM se cayó por un
    // problema del servidor, esta pantalla decía que la contraseña estaba mala
    // y mandó el diagnóstico en la dirección equivocada durante media hora.
    //
    // NextAuth devuelve "CredentialsSignin" cuando el usuario o la clave no
    // calzan. Cualquier otro error —o un estado 500— es un fallo del sistema,
    // y decirlo permite a quien lo ve saber que no es culpa suya.
    if (result?.error) {
      const credencialesMalas = result.error === "CredentialsSignin" && result.status !== 500;
      setError(
        credencialesMalas
          ? "Correo o contraseña incorrectos."
          : "No pudimos verificar tus datos: el sistema tuvo un problema. Vuelve a intentar en un momento; si sigue igual, no es tu contraseña.",
      );
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="email">Correo</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@empresa.com"
        />
      </div>
      <div>
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
      </div>
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Ingresando…" : "Ingresar"}
      </Button>
    </form>
  );
}
