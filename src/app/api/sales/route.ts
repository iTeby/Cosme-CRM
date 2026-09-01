import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { saleCreateSchema } from "@/lib/validation";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "viewSales")) {
    return NextResponse.json({ error: "No tienes permiso para ver ventas" }, { status: 403 });
  }

  const sales = await prisma.sale.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { name: true } },
      createdBy: { select: { name: true } },
      items: { select: { quantity: true } },
    },
  });

  return NextResponse.json(sales);
}

// Registrar una venta descuenta stock automáticamente: por cada línea se crea
// un StockMovement de SALIDA dentro de la misma transacción que la venta, así
// que nunca queda una venta registrada sin su correspondiente salida de stock
// (y viceversa). Si no hay stock suficiente para alguna línea, se aborta todo.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageSales")) {
    return NextResponse.json(
      { error: "No tienes permiso para registrar ventas" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = saleCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { customerId, notes, items } = parsed.data;

  try {
    const sale = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

      const warehouse = await tx.warehouse.findFirst({ where: { isDefault: true } });
      if (!warehouse) throw new Error("NO_WAREHOUSE");

      let totalAmount = 0;
      for (const item of items) {
        totalAmount += item.quantity * item.unitPrice;
      }

      const created = await tx.sale.create({
        data: {
          customerId,
          warehouseId: warehouse.id,
          createdById: session.user.id,
          notes: notes || null,
          totalAmount,
        },
      });

      for (const item of items) {
        const variant = await tx.productVariant.findUnique({ where: { id: item.variantId } });
        if (!variant) throw new Error("VARIANT_NOT_FOUND");

        const existingLevel = await tx.stockLevel.findUnique({
          where: { variantId_warehouseId: { variantId: item.variantId, warehouseId: warehouse.id } },
        });
        const currentQuantity = existingLevel?.quantity ?? 0;
        const nextQuantity = currentQuantity - item.quantity;

        if (nextQuantity < 0) {
          throw new Error(`INSUFFICIENT_STOCK:${variant.sku}`);
        }

        await tx.saleItem.create({
          data: {
            saleId: created.id,
            variantId: item.variantId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: item.quantity * item.unitPrice,
          },
        });

        await tx.stockMovement.create({
          data: {
            variantId: item.variantId,
            warehouseId: warehouse.id,
            type: "SALIDA",
            quantity: -item.quantity,
            reason: `Venta #${created.number}`,
            userId: session.user.id,
            saleId: created.id,
          },
        });

        await tx.stockLevel.upsert({
          where: { variantId_warehouseId: { variantId: item.variantId, warehouseId: warehouse.id } },
          create: { variantId: item.variantId, warehouseId: warehouse.id, quantity: nextQuantity },
          update: { quantity: nextQuantity },
        });
      }

      return tx.sale.findUniqueOrThrow({
        where: { id: created.id },
        include: { items: { include: { variant: true } }, customer: true },
      });
    });

    return NextResponse.json(sale, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message.startsWith("INSUFFICIENT_STOCK")) {
      const sku = message.split(":")[1];
      return NextResponse.json(
        { error: `No hay stock suficiente para el SKU ${sku}` },
        { status: 409 }
      );
    }
    if (message === "CUSTOMER_NOT_FOUND") {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
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
    return NextResponse.json({ error: "No se pudo registrar la venta" }, { status: 500 });
  }
}
