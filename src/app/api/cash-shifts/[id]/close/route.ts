import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { closeShift, ShiftAlreadyClosedError } from "@/lib/cash";
import { shiftCloseSchema, primerMensaje } from "@/lib/validation";

// Cerrar el turno con arqueo. El esperado se congela acá: ver src/lib/cash.ts.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageCashShift")) {
    return NextResponse.json({ error: "No tienes permiso para cerrar la caja" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Cuerpo de la petición inválido" }, { status: 400 });
  }
  const parsed = shiftCloseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: primerMensaje(parsed.error) }, { status: 400 });
  }
  const { countedAmount, notes } = parsed.data;

  try {
    const turno = await prisma.$transaction(
      (tx) => closeShift(tx, params.id, { countedAmount, notes, userId: session.user.id }),
      // El cierre espera detrás del lock de cualquier cobro en efectivo en
      // curso, que es justamente lo que lo hace correcto. Con el presupuesto
      // por defecto de 5 s, un abono a cuenta contra un cliente con muchas
      // ventas hacía caer el cierre con un 500 donde solo había que esperar.
      { timeout: 30000, maxWait: 10000 }
    );

    return NextResponse.json(turno);
  } catch (err: unknown) {
    if (err instanceof ShiftAlreadyClosedError) {
      return NextResponse.json(
        { error: "Ese turno ya está cerrado. Recarga la página." },
        { status: 409 }
      );
    }
    if ((err as { code?: string })?.code === "P2028") {
      return NextResponse.json(
        { error: "Hay un cobro en curso en esta caja. Espera unos segundos y vuelve a cerrar." },
        { status: 409 }
      );
    }
    const message = err instanceof Error ? err.message : "";
    if (message === "SHIFT_NOT_FOUND") {
      return NextResponse.json({ error: "Turno no encontrado" }, { status: 404 });
    }
    if (message === "INVALID_COUNTED_AMOUNT") {
      return NextResponse.json(
        { error: "El monto contado no puede ser negativo" },
        { status: 400 }
      );
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo cerrar el turno" }, { status: 500 });
  }
}
