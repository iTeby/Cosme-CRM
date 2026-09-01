import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";

// Repite un movimiento manual tal cual (mismo producto, bodega, tipo,
// cantidad y motivo) como un movimiento nuevo, aplicando su efecto sobre
// el stock otra vez. Útil para registrar rápido una entrada/salida que se
// repite seguido. Igual que editar/eliminar, no aplica a movimientos
// generados automáticamente por una venta o compra.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
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
      if (source.saleId || source.purchaseId) throw new Error("MOVEMENT_LOCKED");

      const level = await tx.stockLevel.findUnique({
        where: {
          variantId_warehouseId: {
            variantId: source.variantId,
            warehouseId: source.warehouseId,
          },
        },
      });
      const currentQuantity = level?.quantity ?? 0;
      const nextQuantity = currentQuantity + source.quantity;

      if (nextQuantity < 0) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      const movement = await tx.stockMovement.create({
        data: {
          variantId: source.variantId,
          warehouseId: source.warehouseId,
          type: source.type,
          quantity: source.quantity,
          reason: source.reason,
          userId: session.user.id,
        },
        include: {
          variant: { include: { product: true } },
          warehouse: true,
          user: { select: { name: true } },
        },
      });

      await tx.stockLevel.upsert({
        where: {
          variantId_warehouseId: {
            variantId: source.variantId,
            warehouseId: source.warehouseId,
          },
        },
        create: { variantId: source.variantId, warehouseId: source.warehouseId, quantity: nextQuantity },
        update: { quantity: nextQuantity },
      });

      return movement;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message === "MOVEMENT_NOT_FOUND") {
      return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });
    }
    if (message === "MOVEMENT_LOCKED") {
      return NextResponse.json(
        {
          error:
            "Este movimiento fue generado automáticamente por una venta o compra y no se puede duplicar directamente.",
        },
        { status: 409 }
      );
    }
    if (message === "INSUFFICIENT_STOCK") {
      return NextResponse.json(
        { error: "No hay stock suficiente para repetir ese movimiento" },
        { status: 409 }
      );
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo duplicar el movimiento" }, { status: 500 });
  }
}
