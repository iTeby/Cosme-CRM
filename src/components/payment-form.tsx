"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import { toNumber } from "@/lib/decimal";
import { paymentMethodLabels, paymentMethods, type PaymentMethod } from "@/lib/payments";

/**
 * Registrar un abono, contra una venta concreta o a cuenta del cliente.
 *
 * Con `saleId` el abono va a esa venta. Con `customerId` va a cuenta y el
 * servidor lo reparte de la venta más antigua a la más nueva, como una libreta
 * de fiados. Nunca los dos: el esquema de validación lo rechaza.
 */
export function PaymentForm({
  saleId,
  customerId,
  saldo,
  cashShiftOpen,
  onDone,
}: {
  saleId?: string;
  customerId?: string;
  /** Saldo disponible, para prellenar y para avisar antes de que el servidor rechace. */
  saldo: number;
  /**
   * Si hay turno de caja abierto. El servidor rechaza el efectivo sin turno;
   * saberlo acá permite decirlo antes de que el cajero escriba el monto, en
   * vez de después de apretar el botón.
   */
  cashShiftOpen?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(saldo > 0 ? saldo : ""));
  const [method, setMethod] = useState<PaymentMethod>("EFECTIVO");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const monto = toNumber(amount);
  const excede = monto > saldo;
  const faltaTurno = cashShiftOpen === false && method === "EFECTIVO";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (monto <= 0) {
      setError("El monto debe ser mayor que 0.");
      return;
    }
    if (excede) {
      setError(`El abono supera el saldo de ${formatCurrency(saldo)}.`);
      return;
    }
    if (faltaTurno) {
      setError("Abre el turno de caja antes de cobrar en efectivo.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saleId, customerId, amount: monto, method, notes }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "No se pudo registrar el pago.");
        return;
      }

      setAmount("");
      setNotes("");
      router.refresh();
      onDone?.();
    } catch {
      setError("No se pudo conectar con el servidor. Revisa la conexión y vuelve a intentar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_12rem_1fr]">
        <div>
          <Label htmlFor="pago-monto">Monto</Label>
          {/*
            step="0.01" y no step="1": una venta por peso deja saldos con
            centavos ($2.992,5) y con paso entero el navegador bloquea el
            submit por stepMismatch. El cajero no podía cobrar la venta y el
            saldo quedaba abierto para siempre.
          */}
          <Input
            id="pago-monto"
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => {
              setError(null);
              setAmount(e.target.value);
            }}
          />
        </div>
        <div>
          <Label htmlFor="pago-medio">Medio</Label>
          <Select
            id="pago-medio"
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          >
            {paymentMethods.map((m) => (
              <option key={m} value={m}>
                {paymentMethodLabels[m]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="pago-nota">Nota</Label>
          <Input
            id="pago-nota"
            maxLength={300}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Opcional"
          />
        </div>
      </div>

      {excede && monto > 0 && (
        <p className="text-sm text-amber-700">
          El saldo es {formatCurrency(saldo)}. Un abono mayor se va a rechazar.
        </p>
      )}

      {faltaTurno && (
        <p className="text-sm text-amber-700">
          La caja está cerrada. El efectivo cobrado ahora no podría cuadrarse en ningún arqueo,
          así que primero hay que{" "}
          <Link href="/cash" className="font-medium underline">
            abrir el turno
          </Link>
          . Los otros medios de pago no pasan por el cajón y sí se pueden registrar.
        </p>
      )}

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={loading || saldo <= 0 || faltaTurno}>
        {loading ? "Registrando…" : "Registrar abono"}
      </Button>
    </form>
  );
}
