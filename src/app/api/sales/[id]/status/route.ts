import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { saleStatusUpdateSchema } from "@/lib/validation";

// Transiciones de estado permitidas. ENTREGADA y ANULADA son estados
// finales: una vez ahí, la venta ya no cambia.
const allowedTransitions: Record<string, string[]> = {
  PENDIENTE: ["PAGADA", "ANULADA"],
  PAGADA: ["ENTREGADA", "ANULADA"],
  ENTREGADA: [],
  ANULADA: [],
};

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageSales")) {
    return NextResponse.json(
      { error: "No tienes permiso para cambiar el estado de una venta" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = saleStatusUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { status: nextStatus } = parsed.data;

  try {
    const sale = await prisma.$transaction(async (tx) => {
      const current = await tx.sale.findUnique({
        where: { id: params.id },
        include: { items: true },
      });
      if (!current) throw new Error("SALE_NOT_FOUND");

      const allowed = allowedTransitions[current.status] ?? [];
      if (!allowed.includes(nextStatus)) {
        throw new Error("INVALID_TRANSITION");
      }

      // Al anular, se revierte el stock que la venta había descontado:
      // un StockMovement de ENTRADA por cada línea, dentro de la misma
      // transacción que el cambio de estado.
      if (nextStatus === "ANULADA") {
        for (const item of current.items) {
          await tx.stockMovement.create({
            data: {
              variantId: item.variantId,
              warehouseId: current.warehouseId,
              type: "ENTRADA",
              quantity: item.quantity,
              reason: `Anulación de venta #${current.number}`,
              userId: session.user.id,
              saleId: current.id,
            },
          });

          const level = await tx.stockLevel.findUnique({
            where: {
              variantId_warehouseId: { variantId: item.variantId, warehouseId: current.warehouseId },
            },
          });
          const currentQuantity = level?.quantity ?? 0;

          await tx.stockLevel.upsert({
            where: {
              variantId_warehouseId: { variantId: item.variantId, warehouseId: current.warehouseId },
            },
            create: {
              variantId: item.variantId,
              warehouseId: current.warehouseId,
              quantity: currentQuantity + item.quantity,
            },
            update: { quantity: currentQuantity + item.quantity },
          });
        }
      }

      return tx.sale.update({
        where: { id: params.id },
        data: { status: nextStatus },
        include: { customer: true, items: { include: { variant: { include: { product: true } } } } },
      });
    });

    return NextResponse.json(sale);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message === "SALE_NOT_FOUND") {
      return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
    }
    if (message === "INVALID_TRANSITION") {
      return NextResponse.json(
        { error: "Ese cambio de estado no está permitido" },
        { status: 409 }
      );
    }
    console.error(err);
    return NextResponse.json(
      { error: "No se pudo actualizar el estado de la venta" },
      { status: 500 }
    );
  }
}
