import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { openShift, ShiftAlreadyOpenError } from "@/lib/cash";
import { shiftOpenSchema, primerMensaje } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "viewCashShift")) {
    return NextResponse.json({ error: "No tienes permiso para ver la caja" }, { status: 403 });
  }

  const limit = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get("limit")) || 30, 100));

  const shifts = await prisma.cashShift.findMany({
    orderBy: { openedAt: "desc" },
    take: limit,
    include: {
      warehouse: { select: { name: true } },
      openedBy: { select: { name: true } },
      closedBy: { select: { name: true } },
    },
  });

  return NextResponse.json(shifts);
}

// Abrir turno. La unicidad del turno abierto la garantiza el índice de
// openKey, no una lectura previa: ver src/lib/cash.ts.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageCashShift")) {
    return NextResponse.json({ error: "No tienes permiso para abrir la caja" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Cuerpo de la petición inválido" }, { status: 400 });
  }
  const parsed = shiftOpenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: primerMensaje(parsed.error) }, { status: 400 });
  }
  const { openingAmount, warehouseId, notes } = parsed.data;

  try {
    const turno = await prisma.$transaction(async (tx) => {
      const bodega = await tx.warehouse.findFirst({ where: { isDefault: true } });
      if (!bodega) throw new Error("NO_WAREHOUSE");

      // La pantalla de caja solo mira la bodega por defecto. Aceptar otra
      // dejaría un turno abierto que la interfaz no muestra ni puede cerrar,
      // y los cobros en efectivo de esa bodega entrarían ahí, fuera de todo
      // arqueo visible. Cuando haya interfaz multi-caja, esto se abre.
      if (warehouseId && warehouseId !== bodega.id) throw new Error("WAREHOUSE_NOT_SUPPORTED");

      return openShift(tx, {
        warehouseId: bodega.id,
        openingAmount,
        notes,
        userId: session.user.id,
      });
    });

    return NextResponse.json(turno, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof ShiftAlreadyOpenError) {
      return NextResponse.json(
        { error: "Ya hay un turno de caja abierto. Ciérralo antes de abrir otro." },
        { status: 409 }
      );
    }
    const message = err instanceof Error ? err.message : "";
    if (message === "WAREHOUSE_NOT_SUPPORTED") {
      return NextResponse.json(
        { error: "Por ahora solo se puede abrir la caja de la bodega principal" },
        { status: 400 }
      );
    }
    if (message === "NO_WAREHOUSE") {
      return NextResponse.json(
        { error: "No hay ninguna bodega por defecto configurada" },
        { status: 500 }
      );
    }
    if (message === "INVALID_OPENING_AMOUNT") {
      return NextResponse.json({ error: "El fondo no puede ser negativo" }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo abrir el turno" }, { status: 500 });
  }
}
