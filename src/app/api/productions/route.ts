import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import {
  applyProduction,
  InvalidRecipeError,
  WastageExceedsStockError,
} from "@/lib/production";
import { InsufficientStockError } from "@/lib/inventory";
import { productionCreateSchema, primerMensaje } from "@/lib/validation";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "viewProduction")) {
    return NextResponse.json({ error: "No tienes permiso para ver producciones" }, { status: 403 });
  }

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = Math.max(1, Math.min(Number(limitParam) || 30, 100));

  const productions = await prisma.productionOrder.findMany({
    orderBy: { producedOn: "desc" },
    take: limit,
    include: {
      warehouse: { select: { name: true } },
      createdBy: { select: { name: true } },
      items: { include: { variant: { include: { product: true } } } },
    },
  });

  return NextResponse.json(productions);
}

// Registrar lo que se horneó. Toda la escritura de inventario la hace
// applyProduction() en src/lib/production.ts, dentro de esta transacción: si
// falta un insumo para cualquier línea, no queda registrada ninguna.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageProduction")) {
    return NextResponse.json(
      { error: "No tienes permiso para registrar producciones" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = productionCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: primerMensaje(parsed.error) }, { status: 400 });
  }
  const { warehouseId, producedOn, notes, items } = parsed.data;

  try {
    const production = await prisma.$transaction(
      async (tx) => {
        const warehouse = warehouseId
          ? await tx.warehouse.findUnique({ where: { id: warehouseId } })
          : await tx.warehouse.findFirst({ where: { isDefault: true } });
        if (!warehouse) throw new Error("NO_WAREHOUSE");

        for (const item of items) {
          const variant = await tx.productVariant.findUnique({
            where: { id: item.variantId },
            select: { id: true },
          });
          if (!variant) throw new Error("VARIANT_NOT_FOUND");
        }

        const order = await applyProduction(tx, {
          warehouseId: warehouse.id,
          userId: session.user.id,
          producedOn,
          notes,
          items,
        });

        return tx.productionOrder.findUniqueOrThrow({
          where: { id: order.id },
          include: {
            warehouse: { select: { name: true } },
            createdBy: { select: { name: true } },
            items: { include: { variant: { include: { product: true } } } },
          },
        });
      },
      { timeout: 55000, maxWait: 15000 }
    );

    return NextResponse.json(production, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof InsufficientStockError) {
      return NextResponse.json(
        {
          error: err.sku
            ? `No hay insumo suficiente: falta ${err.sku}`
            : "No hay insumo suficiente para esa producción",
        },
        { status: 409 }
      );
    }
    if (err instanceof WastageExceedsStockError) {
      return NextResponse.json(
        {
          error: err.sku
            ? `La merma de ${err.sku} supera lo que hay en bodega`
            : "La merma registrada supera lo que hay en bodega",
        },
        { status: 409 }
      );
    }
    if (err instanceof InvalidRecipeError) {
      return NextResponse.json(
        { error: "Una de las recetas rinde cero unidades y no se puede escalar" },
        { status: 409 }
      );
    }
    const message = err instanceof Error ? err.message : "";
    if (message === "NO_WAREHOUSE") {
      return NextResponse.json(
        { error: "No hay ninguna bodega por defecto configurada" },
        { status: 500 }
      );
    }
    if (message === "VARIANT_NOT_FOUND") {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }
    if (message === "DUPLICATE_PRODUCTION_ITEM") {
      return NextResponse.json(
        { error: "Hay un producto repetido en la producción" },
        { status: 400 }
      );
    }
    if (message === "NEGATIVE_QUANTITY") {
      return NextResponse.json({ error: "Las cantidades no pueden ser negativas" }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo registrar la producción" }, { status: 500 });
  }
}
