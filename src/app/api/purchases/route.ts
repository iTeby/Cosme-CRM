import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { purchaseCreateSchema } from "@/lib/validation";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "viewPurchases")) {
    return NextResponse.json({ error: "No tienes permiso para ver compras" }, { status: 403 });
  }

  const purchases = await prisma.purchase.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      supplier: { select: { name: true } },
      createdBy: { select: { name: true } },
      items: { select: { quantity: true } },
    },
  });

  return NextResponse.json(purchases);
}

// A diferencia de una venta, registrar una orden de compra NO toca el stock:
// queda en PENDIENTE hasta que se marca RECIBIDA (ver [id]/status/route.ts),
// que es cuando realmente entra la mercadería a la bodega.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "managePurchases")) {
    return NextResponse.json(
      { error: "No tienes permiso para registrar compras" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = purchaseCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { supplierId, notes, items } = parsed.data;

  try {
    const purchase = await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw new Error("SUPPLIER_NOT_FOUND");

      const warehouse = await tx.warehouse.findFirst({ where: { isDefault: true } });
      if (!warehouse) throw new Error("NO_WAREHOUSE");

      let totalAmount = 0;
      for (const item of items) {
        totalAmount += item.quantity * item.unitCost;
      }

      const created = await tx.purchase.create({
        data: {
          supplierId,
          warehouseId: warehouse.id,
          createdById: session.user.id,
          notes: notes || null,
          totalAmount,
        },
      });

      for (const item of items) {
        const variant = await tx.productVariant.findUnique({ where: { id: item.variantId } });
        if (!variant) throw new Error("VARIANT_NOT_FOUND");

        await tx.purchaseItem.create({
          data: {
            purchaseId: created.id,
            variantId: item.variantId,
            quantity: item.quantity,
            unitCost: item.unitCost,
            subtotal: item.quantity * item.unitCost,
          },
        });
      }

      return tx.purchase.findUniqueOrThrow({
        where: { id: created.id },
        include: { items: { include: { variant: true } }, supplier: true },
      });
    });

    return NextResponse.json(purchase, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message === "SUPPLIER_NOT_FOUND") {
      return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
    }
    if (message === "VARIANT_NOT_FOUND") {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }
    if (message === "NO_WAREHOUSE") {
      return NextResponse.json(
        { error: "No hay ninguna bodega por defecto configurada" },
        { status: 500 }
      );
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo registrar la compra" }, { status: 500 });
  }
}
