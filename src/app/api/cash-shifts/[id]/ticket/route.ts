import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { expectedCash, shiftTotals } from "@/lib/cash";
import { nombreDelNegocio, respuestaImpresion, ticketCierreTurno } from "@/lib/printing";
import { round2, toNumber } from "@/lib/decimal";

// El comprobante del arqueo. Con el turno abierto sale como corte X, que es
// una lectura y no cierra nada; con el turno cerrado, el cierre definitivo.
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "viewCashShift")) {
    return NextResponse.json({ error: "No tienes permiso para ver la caja" }, { status: 403 });
  }

  const turno = await prisma.cashShift.findUnique({
    where: { id: params.id },
    include: {
      openedBy: { select: { name: true } },
      closedBy: { select: { name: true } },
    },
  });

  if (!turno) return NextResponse.json({ error: "Turno no encontrado" }, { status: 404 });

  const totales = await shiftTotals(prisma, turno.id);
  const abierto = turno.status === "ABIERTO";

  // Con el turno abierto el esperado se calcula al vuelo; con el turno
  // cerrado se usa el que quedó congelado, que es el que se firmó.
  const esperado = abierto ? await expectedCash(prisma, turno.id) : toNumber(turno.expectedAmount);
  const contado = abierto ? 0 : toNumber(turno.countedAmount);
  const diferencia = abierto ? 0 : toNumber(turno.difference);

  const bytes = ticketCierreTurno({
    negocio: nombreDelNegocio(),
    turno: turno.number,
    abiertoPor: turno.openedBy.name,
    cerradoPor: turno.closedBy?.name ?? null,
    abiertoEn: turno.openedAt,
    cerradoEn: turno.closedAt ?? turno.openedAt,
    fondo: turno.openingAmount,
    porMedio: totales.porMedio,
    ventas: totales.ventas,
    esperado,
    contado,
    diferencia: round2(diferencia),
    nota: turno.closingNotes,
    esLectura: abierto,
  });

  return respuestaImpresion(bytes, `turno-${turno.number}${abierto ? "-corte-x" : ""}.bin`);
}
