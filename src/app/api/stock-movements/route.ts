import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { applyMovement, toDelta, InsufficientStockError } from "@/lib/inventory";
import { stockMovementSchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = Math.max(1, Math.min(Number(limitParam) || 50, 200));

  const movements = await prisma.stockMovement.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      variant: { include: { product: true } },
      warehouse: true,
      user: { select: { name: true, email: true } },
    },
  });

  return NextResponse.json(movements);
}

// Registrar un movimiento manual de inventario. El efecto sobre el stock lo
// aplica applyMovement() en src/lib/inventory.ts, que es el único lugar del
// proyecto que escribe StockMovement y StockLevel.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageStock")) {
    return NextResponse.json(
      { error: "No tienes permiso para registrar movimientos de inventario" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = stockMovementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { variantId, warehouseId, type, quantity, reason } = parsed.data;

  if (type !== "AJUSTE" && quantity < 0) {
    return NextResponse.json(
      { error: "Entradas y salidas deben ingresarse como un número positivo" },
      { status: 400 }
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.findUnique({ where: { id: variantId } });
      if (!variant) throw new Error("VARIANT_NOT_FOUND");

      const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId } });
      if (!warehouse) throw new Error("WAREHOUSE_NOT_FOUND");

      const { movement } = await applyMovement(tx, {
        variantId,
        warehouseId,
        type,
        delta: toDelta(type, quantity),
        reason,
        userId: session.user.id,
      });

      return movement;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof InsufficientStockError) {
      return NextResponse.json(
        { error: "No hay stock suficiente para esa salida" },
        { status: 409 }
      );
    }
    const message = err instanceof Error ? err.message : "";
    if (message === "VARIANT_NOT_FOUND" || message === "WAREHOUSE_NOT_FOUND") {
      return NextResponse.json({ error: "Producto o bodega no encontrados" }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json(
      { error: "No se pudo registrar el movimiento" },
      { status: 500 }
    );
  }
}
