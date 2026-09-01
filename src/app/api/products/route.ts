import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { productCreateSchema } from "@/lib/validation";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      variants: {
        include: { stockLevels: true },
      },
    },
  });

  return NextResponse.json(products);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageProducts")) {
    return NextResponse.json(
      { error: "No tienes permiso para crear productos" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = productCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, description, category, variants } = parsed.data;

  const skus = variants.map((v) => v.sku);
  if (new Set(skus).size !== skus.length) {
    return NextResponse.json(
      { error: "Hay SKU repetidos entre las variantes" },
      { status: 400 }
    );
  }

  try {
    const warehouse = await prisma.warehouse.findFirst({ where: { isDefault: true } });
    if (!warehouse) {
      return NextResponse.json(
        { error: "No hay ninguna bodega por defecto configurada" },
        { status: 500 }
      );
    }

    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          name,
          description: description || null,
          category: category || null,
          variants: {
            create: variants.map((v) => ({
              sku: v.sku,
              attributes: v.attributes || null,
              price: v.price,
              cost: v.cost,
              lowStockThreshold: v.lowStockThreshold,
            })),
          },
        },
        include: { variants: true },
      });

      for (const variant of created.variants) {
        const initialQuantity =
          variants.find((v) => v.sku === variant.sku)?.initialQuantity ?? 0;

        await tx.stockLevel.create({
          data: {
            variantId: variant.id,
            warehouseId: warehouse.id,
            quantity: initialQuantity,
          },
        });

        if (initialQuantity > 0) {
          await tx.stockMovement.create({
            data: {
              variantId: variant.id,
              warehouseId: warehouse.id,
              type: "AJUSTE",
              quantity: initialQuantity,
              reason: "Carga inicial de stock",
              userId: session.user.id,
            },
          });
        }
      }

      return created;
    });

    return NextResponse.json(product, { status: 201 });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "P2002") {
      return NextResponse.json(
        { error: "Ya existe una variante con ese SKU" },
        { status: 409 }
      );
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo crear el producto" }, { status: 500 });
  }
}
