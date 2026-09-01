import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { purchaseStatusUpdateSchema } from "@/lib/validation";

// Transiciones de estado permitidas. ANULADA es un estado final; RECIBIDA
// solo puede pasar a ANULADA (para corregir una recepción por error).
const allowedTransitions: Record<string, string[]> = {
  PENDIENTE: ["RECIBIDA", "ANULADA"],
  RECIBIDA: ["ANULADA"],
  ANULADA: [],
};

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "managePurchases")) {
    return NextResponse.json(
      { error: "No tienes permiso para cambiar el estado de una compra" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = purchaseStatusUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { status: nextStatus } = parsed.data;

  try {
    const purchase = await prisma.$transaction(async (tx) => {
      const current = await tx.purchase.findUnique({
        where: { id: params.id },
        include: { items: true },
      });
      if (!current) throw new Error("PURCHASE_NOT_FOUND");

      const allowed = allowedTransitions[current.status] ?? [];
      if (!allowed.includes(nextStatus)) {
        throw new Error("INVALID_TRANSITION");
      }

      // Al marcar RECIBIDA, recién ahí entra la mercadería: un StockMovement
      // ENTRADA por cada línea, dentro de la misma transacción.
      if (nextStatus === "RECIBIDA") {
        for (const item of current.items) {
          await tx.stockMovement.create({
            data: {
              variantId: item.variantId,
              warehouseId: current.warehouseId,
              type: "ENTRADA",
              quantity: item.quantity,
              reason: `Recepción de compra #${current.number}`,
              userId: session.user.id,
              purchaseId: current.id,
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

      // Si se anula una compra que ya había sido recibida, se revierte el
      // stock que había entrado (puede dejar el stock en negativo si ya se
      // vendió parte de esa mercadería; es una corrección manual del error).
      if (nextStatus === "ANULADA" && current.status === "RECIBIDA") {
        for (const item of current.items) {
          await tx.stockMovement.create({
            data: {
              variantId: item.variantId,
              warehouseId: current.warehouseId,
              type: "SALIDA",
              quantity: -item.quantity,
              reason: `Anulación de compra #${current.number}`,
              userId: session.user.id,
              purchaseId: current.id,
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
              quantity: currentQuantity - item.quantity,
            },
            update: { quantity: currentQuantity - item.quantity },
          });
        }
      }

      return tx.purchase.update({
        where: { id: params.id },
        data: { status: nextStatus },
        include: {
          supplier: true,
          items: { include: { variant: { include: { product: true } } } },
        },
      });
    });

    return NextResponse.json(purchase);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message === "PURCHASE_NOT_FOUND") {
      return NextResponse.json({ error: "Compra no encontrada" }, { status: 404 });
    }
    if (message === "INVALID_TRANSITION") {
      return NextResponse.json(
        { error: "Ese cambio de estado no está permitido" },
        { status: 409 }
      );
    }
    console.error(err);
    return NextResponse.json(
      { error: "No se pudo actualizar el estado de la compra" },
      { status: 500 }
    );
  }
}
