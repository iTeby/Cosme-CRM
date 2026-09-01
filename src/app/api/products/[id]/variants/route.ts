import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { variantAddSchema } from "@/lib/validation";

// Agrega una variante/SKU nueva a un producto existente.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageProducts")) {
    return NextResponse.json(
      { error: "No tienes permiso para editar productos" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = variantAddSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { sku, attributes, price, cost, lowStockThreshold, initialQuantity } = parsed.data;

  const product = await prisma.product.findUnique({ where: { id: params.id } });
  if (!product) {
    return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
  }

  const warehouse = await prisma.warehouse.findFirst({ where: { isDefault: true } });
  if (!warehouse) {
    return NextResponse.json(
      { error: "No hay ninguna bodega por defecto configurada" },
      { status: 500 }
    );
  }

  try {
    const variant = await prisma.$transaction(async (tx) => {
      const created = await tx.productVariant.create({
        data: {
          productId: product.id,
          sku,
          attributes: attributes || null,
          price,
          cost,
          lowStockThreshold,
        },
      });

      await tx.stockLevel.create({
        data: { variantId: created.id, warehouseId: warehouse.id, quantity: initialQuantity },
      });

      if (initialQuantity > 0) {
        await tx.stockMovement.create({
          data: {
            variantId: created.id,
            warehouseId: warehouse.id,
            type: "AJUSTE",
            quantity: initialQuantity,
            reason: "Carga inicial de stock",
            userId: session.user.id,
          },
        });
      }

      return created;
    });

    return NextResponse.json(variant, { status: 201 });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "P2002") {
      return NextResponse.json({ error: "Ya existe una variante con ese SKU" }, { status: 409 });
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo crear la variante" }, { status: 500 });
  }
}
