import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import {
  replaceMovement,
  removeMovement,
  toDelta,
  InsufficientStockError,
} from "@/lib/inventory";
import { stockMovementUpdateSchema } from "@/lib/validation";

type Tx = Prisma.TransactionClient;

// Editar o eliminar un movimiento ya registrado es más delicado que crear uno
// nuevo: hay que revertir o reaplicar su efecto sobre StockLevel dentro de la
// misma transacción. Esa parte vive en src/lib/inventory.ts; acá solo quedan
// los permisos, la validación y el mapeo de errores.
//
// Ninguna de las dos operaciones toca un movimiento generado automáticamente
// por una Venta, una Compra o una Producción: esos se corrigen anulando el
// documento que los originó, no editando el movimiento a mano. Borrar el
// CONSUMO de una producción, por ejemplo, devolvería la harina al stock
// dejando la orden diciendo que se hornearon 200 panes con ella.
async function loadEditableMovement(tx: Tx, id: string) {
  const movement = await tx.stockMovement.findUnique({ where: { id } });
  if (!movement) throw new Error("MOVEMENT_NOT_FOUND");
  if (movement.saleId || movement.purchaseId || movement.productionId) {
    throw new Error("MOVEMENT_LOCKED");
  }
  return movement;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "editStockMovements")) {
    return NextResponse.json(
      { error: "No tienes permiso para editar movimientos de inventario" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = stockMovementUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { type, quantity, reason } = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await loadEditableMovement(tx, params.id);
      return replaceMovement(tx, current, {
        type,
        delta: toDelta(type, quantity),
        reason,
      });
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    return NextResponse.json(mapError(err), { status: statusFor(err) });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "editStockMovements")) {
    return NextResponse.json(
      { error: "No tienes permiso para eliminar movimientos de inventario" },
      { status: 403 }
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      const current = await loadEditableMovement(tx, params.id);
      await removeMovement(tx, current);
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json(mapError(err), { status: statusFor(err) });
  }
}

function mapError(err: unknown): { error: string } {
  if (err instanceof InsufficientStockError) {
    return {
      error:
        "No se puede aplicar ese cambio: el stock ya se movió después de este registro y quedaría en negativo.",
    };
  }
  const message = err instanceof Error ? err.message : "";
  if (message === "MOVEMENT_NOT_FOUND") return { error: "Movimiento no encontrado" };
  if (message === "MOVEMENT_LOCKED") {
    return {
      error:
        "Este movimiento fue generado automáticamente por una venta, una compra o una producción, y no se puede editar ni eliminar directamente. Anula el documento que lo originó para revertirlo.",
    };
  }
  console.error(err);
  return { error: "No se pudo completar la operación" };
}

function statusFor(err: unknown): number {
  if (err instanceof InsufficientStockError) return 409;
  const message = err instanceof Error ? err.message : "";
  if (message === "MOVEMENT_NOT_FOUND") return 404;
  if (message === "MOVEMENT_LOCKED") return 409;
  return 500;
}
