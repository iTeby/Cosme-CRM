import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { stockMovementUpdateSchema } from "@/lib/validation";

type Tx = Prisma.TransactionClient;

// Editar o eliminar un movimiento ya registrado es más delicado que crear
// uno nuevo: hay que revertir/reaplicar su efecto sobre StockLevel dentro
// de la misma transacción para que el stock nunca quede desincronizado del
// historial. Por eso ambas operaciones están restringidas a Admin
// (editStockMovements), y ninguna de las dos toca un movimiento que haya
// sido generado automáticamente por una Venta o una Compra (saleId /
// purchaseId): esos se corrigen anulando la venta/compra correspondiente,
// no editando el movimiento a mano.
async function loadEditableMovement(tx: Tx, id: string) {
  const movement = await tx.stockMovement.findUnique({ where: { id } });
  if (!movement) throw new Error("MOVEMENT_NOT_FOUND");
  if (movement.saleId || movement.purchaseId) throw new Error("MOVEMENT_LOCKED");
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
  const newDelta = type === "SALIDA" ? -Math.abs(quantity) : quantity;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await loadEditableMovement(tx, params.id);

      const level = await tx.stockLevel.findUnique({
        where: {
          variantId_warehouseId: {
            variantId: current.variantId,
            warehouseId: current.warehouseId,
          },
        },
      });
      const currentQuantity = level?.quantity ?? 0;
      // Se saca el efecto del movimiento viejo y se aplica el nuevo en un
      // solo paso (no dos), para no pasar por un estado intermedio negativo
      // si, por ejemplo, se está corrigiendo una entrada grande por una chica.
      const nextQuantity = currentQuantity - current.quantity + newDelta;

      if (nextQuantity < 0) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      await tx.stockLevel.upsert({
        where: {
          variantId_warehouseId: {
            variantId: current.variantId,
            warehouseId: current.warehouseId,
          },
        },
        create: { variantId: current.variantId, warehouseId: current.warehouseId, quantity: nextQuantity },
        update: { quantity: nextQuantity },
      });

      return tx.stockMovement.update({
        where: { id: current.id },
        data: { type, quantity: newDelta, reason: reason || null },
        include: {
          variant: { include: { product: true } },
          warehouse: true,
          user: { select: { name: true } },
        },
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

      const level = await tx.stockLevel.findUnique({
        where: {
          variantId_warehouseId: {
            variantId: current.variantId,
            warehouseId: current.warehouseId,
          },
        },
      });
      const currentQuantity = level?.quantity ?? 0;
      const nextQuantity = currentQuantity - current.quantity;

      if (nextQuantity < 0) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      await tx.stockLevel.upsert({
        where: {
          variantId_warehouseId: {
            variantId: current.variantId,
            warehouseId: current.warehouseId,
          },
        },
        create: { variantId: current.variantId, warehouseId: current.warehouseId, quantity: nextQuantity },
        update: { quantity: nextQuantity },
      });

      await tx.stockMovement.delete({ where: { id: current.id } });
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json(mapError(err), { status: statusFor(err) });
  }
}

function mapError(err: unknown): { error: string } {
  const message = err instanceof Error ? err.message : "";
  if (message === "MOVEMENT_NOT_FOUND") return { error: "Movimiento no encontrado" };
  if (message === "MOVEMENT_LOCKED") {
    return {
      error:
        "Este movimiento fue generado automáticamente por una venta o compra y no se puede editar ni eliminar directamente. Anula la venta o compra correspondiente para revertirlo.",
    };
  }
  if (message === "INSUFFICIENT_STOCK") {
    return {
      error:
        "No se puede aplicar ese cambio: el stock ya se movió después de este registro y quedaría en negativo.",
    };
  }
  console.error(err);
  return { error: "No se pudo completar la operación" };
}

function statusFor(err: unknown): number {
  const message = err instanceof Error ? err.message : "";
  if (message === "MOVEMENT_NOT_FOUND") return 404;
  if (message === "MOVEMENT_LOCKED") return 409;
  if (message === "INSUFFICIENT_STOCK") return 409;
  return 500;
}
