import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { applyMovement, InsufficientStockError } from "@/lib/inventory";

// Repite un movimiento manual tal cual (mismo producto, bodega, tipo, cantidad
// y motivo) como un movimiento nuevo. La cantidad del original ya viene con
// signo, así que se pasa como delta sin volver a interpretarla. Igual que
// editar o eliminar, no aplica a movimientos generados por una venta o compra.
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "editStockMovements")) {
    return NextResponse.json(
      { error: "No tienes permiso para duplicar movimientos de inventario" },
      { status: 403 }
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const source = await tx.stockMovement.findUnique({ where: { id: params.id } });
      if (!source) throw new Error("MOVEMENT_NOT_FOUND");
      if (source.saleId || source.purchaseId || source.productionId) {
        throw new Error("MOVEMENT_LOCKED");
      }

      const { movement } = await applyMovement(tx, {
        variantId: source.variantId,
        warehouseId: source.warehouseId,
        type: source.type,
        delta: source.quantity,
        reason: source.reason,
        userId: session.user.id,
        // El duplicado va al mismo lote que el original: sin esto, duplicar
        // un movimiento de un producto con lotes movía el nivel y dejaba el
        // lote atrás.
        lotId: source.lotId,
      });

      return movement;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof InsufficientStockError) {
      return NextResponse.json(
        { error: "No hay stock suficiente para repetir ese movimiento" },
        { status: 409 }
      );
    }
    const message = err instanceof Error ? err.message : "";
    if (message === "MOVEMENT_NOT_FOUND") {
      return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });
    }
    if (message === "MOVEMENT_LOCKED") {
      return NextResponse.json(
        {
          error:
            "Este movimiento fue generado automáticamente por una venta, una compra o una producción, y no se puede duplicar directamente.",
        },
        { status: 409 }
      );
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo duplicar el movimiento" }, { status: 500 });
  }
}
