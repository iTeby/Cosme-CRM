import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { removePayment, ShiftClosedError } from "@/lib/payments";

// Deshacer un abono mal registrado devuelve el saldo a la venta. No es un
// "borrar y olvidar": la fila se elimina y paidAmount baja en la misma
// transacción, así que el snapshot nunca se despega de la suma de pagos.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "managePayments")) {
    return NextResponse.json({ error: "No tienes permiso para deshacer pagos" }, { status: 403 });
  }

  try {
    await prisma.$transaction(async (tx) => removePayment(tx, params.id));
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof ShiftClosedError) {
      return NextResponse.json(
        {
          error:
            "Ese abono en efectivo ya entró en un turno cerrado y arqueado. No se puede deshacer sin alterar un cuadre firmado.",
        },
        { status: 409 }
      );
    }
    const message = err instanceof Error ? err.message : "";
    if (message === "PAYMENT_NOT_FOUND") {
      return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
    }
    if ((err as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
    }
    if (message === "NEGATIVE_PAID_AMOUNT") {
      return NextResponse.json(
        { error: "No se pudo deshacer: el saldo de la venta quedaría inconsistente." },
        { status: 409 }
      );
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo deshacer el pago" }, { status: 500 });
  }
}
