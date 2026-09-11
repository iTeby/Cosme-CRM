import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { canTransitionPurchase } from "@/lib/purchases";
import { applyMovement } from "@/lib/inventory";
import { purchaseStatusUpdateSchema } from "@/lib/validation";

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

      if (!canTransitionPurchase(current.status, nextStatus)) {
        throw new Error("INVALID_TRANSITION");
      }

      // Condicionado al estado leído: ver la nota en la ruta de ventas. Un
      // doble click en "Marcar recibida" ingresaría la mercadería dos veces.
      const claimed = await tx.purchase.updateMany({
        where: { id: params.id, status: current.status },
        data: { status: nextStatus },
      });
      if (claimed.count === 0) throw new Error("CONCURRENT_UPDATE");

      // Al marcar RECIBIDA recién ahí entra la mercadería.
      if (nextStatus === "RECIBIDA") {
        for (const item of current.items) {
          await applyMovement(tx, {
            variantId: item.variantId,
            warehouseId: current.warehouseId,
            type: "ENTRADA",
            delta: item.quantity,
            reason: `Recepción de compra #${current.number}`,
            userId: session.user.id,
            purchaseId: current.id,
          });
        }
      }

      // Anular una compra ya recibida revierte esa entrada. Puede dejar el
      // stock en negativo si parte de la mercadería ya se vendió: es una
      // corrección manual de un error, y por eso se permite explícitamente.
      if (nextStatus === "ANULADA" && current.status === "RECIBIDA") {
        for (const item of current.items) {
          await applyMovement(tx, {
            variantId: item.variantId,
            warehouseId: current.warehouseId,
            type: "SALIDA",
            delta: -item.quantity,
            reason: `Anulación de compra #${current.number}`,
            userId: session.user.id,
            purchaseId: current.id,
            allowNegative: true,
          });
        }
      }

      return tx.purchase.findUniqueOrThrow({
        where: { id: params.id },
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
    if (message === "CONCURRENT_UPDATE") {
      return NextResponse.json(
        { error: "Alguien más cambió el estado de esta compra. Recarga y vuelve a intentar." },
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
