import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { canTransitionSale } from "@/lib/sales";
import { applyMovement } from "@/lib/inventory";
import { saleStatusUpdateSchema } from "@/lib/validation";

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

      if (!canTransitionSale(current.status, nextStatus)) {
        throw new Error("INVALID_TRANSITION");
      }

      // El cambio de estado se hace acá, condicionado al estado que acabamos de
      // leer, y no al final. Sin esto, dos peticiones simultáneas —un doble
      // click con la red lenta— leerían ambas PENDIENTE, ambas pasarían la
      // validación y ambas revertirían el stock: el inventario quedaría con el
      // doble de unidades y dos movimientos legítimos respaldándolo. Con el
      // WHERE por estado, la segunda no afecta ninguna fila y se aborta.
      const claimed = await tx.sale.updateMany({
        where: { id: params.id, status: current.status },
        data: { status: nextStatus },
      });
      if (claimed.count === 0) throw new Error("CONCURRENT_UPDATE");

      // Al anular se revierte el stock que la venta había descontado: una
      // ENTRADA por cada línea, en la misma transacción que el cambio de estado.
      if (nextStatus === "ANULADA") {
        for (const item of current.items) {
          await applyMovement(tx, {
            variantId: item.variantId,
            warehouseId: current.warehouseId,
            type: "ENTRADA",
            delta: item.quantity,
            reason: `Anulación de venta #${current.number}`,
            userId: session.user.id,
            saleId: current.id,
          });
        }
      }

      return tx.sale.findUniqueOrThrow({
        where: { id: params.id },
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
    if (message === "CONCURRENT_UPDATE") {
      return NextResponse.json(
        { error: "Alguien más cambió el estado de esta venta. Recarga y vuelve a intentar." },
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
