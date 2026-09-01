import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { stockMovementSchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(Number(limitParam) || 50, 200);

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

// Toda la lógica de inventario pasa por acá: un movimiento nunca borra ni
// edita el historial, solo se agregan filas nuevas. StockLevel es siempre
// la suma de todos los movimientos de esa variante+bodega, y se actualiza
// dentro de la misma transacción para que nunca queden desincronizados.
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

  // Delta que se aplica al stock actual. Para ENTRADA suma, para SALIDA
  // resta, y para AJUSTE se aplica tal cual lo ingresado (puede ser negativo,
  // por ejemplo tras un conteo físico que da menos de lo esperado).
  const delta = type === "SALIDA" ? -Math.abs(quantity) : quantity;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.findUnique({ where: { id: variantId } });
      if (!variant) throw new Error("VARIANT_NOT_FOUND");

      const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId } });
      if (!warehouse) throw new Error("WAREHOUSE_NOT_FOUND");

      const existingLevel = await tx.stockLevel.findUnique({
        where: { variantId_warehouseId: { variantId, warehouseId } },
      });
      const currentQuantity = existingLevel?.quantity ?? 0;
      const nextQuantity = currentQuantity + delta;

      if (nextQuantity < 0) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      const movement = await tx.stockMovement.create({
        data: {
          variantId,
          warehouseId,
          type,
          quantity: delta,
          reason: reason || null,
          userId: session.user.id,
        },
      });

      await tx.stockLevel.upsert({
        where: { variantId_warehouseId: { variantId, warehouseId } },
        create: { variantId, warehouseId, quantity: nextQuantity },
        update: { quantity: nextQuantity },
      });

      return movement;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message === "INSUFFICIENT_STOCK") {
      return NextResponse.json(
        { error: "No hay stock suficiente para esa salida" },
        { status: 409 }
      );
    }
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
