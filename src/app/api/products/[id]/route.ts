import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { productUpdateSchema } from "@/lib/validation";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const product = await prisma.product.findUnique({
    where: { id: params.id },
    include: {
      variants: {
        include: { stockLevels: { include: { warehouse: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!product) {
    return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
  }

  return NextResponse.json(product);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageProducts")) {
    return NextResponse.json(
      { error: "No tienes permiso para editar productos" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = productUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, description, category, active } = parsed.data;

  try {
    const product = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id: params.id },
        data: { name, description: description || null, category: category || null, active },
      });

      // Bloquear un producto también bloquea sus variantes: los selectores
      // de Venta y Compra solo filtran por el estado de la variante, así
      // que si no se hace esto un producto "bloqueado" se seguiría pudiendo
      // vender/comprar. Al reactivar el producto NO se reactivan las
      // variantes automáticamente, para no pisar una que se haya
      // desactivado por otro motivo.
      if (!active) {
        await tx.productVariant.updateMany({
          where: { productId: params.id },
          data: { active: false },
        });
      }

      return updated;
    });
    return NextResponse.json(product);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo actualizar el producto" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageProducts")) {
    return NextResponse.json(
      { error: "No tienes permiso para eliminar productos" },
      { status: 403 }
    );
  }

  try {
    await prisma.product.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "P2025") {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }
    // El producto tiene variantes con ventas, compras o movimientos de
    // inventario asociados (esas tablas no tienen onDelete: Cascade a
    // propósito, para no perder historial). En ese caso no se puede
    // eliminar de forma permanente — hay que bloquearlo en su lugar.
    if (code === "P2003" || code === "P2014") {
      return NextResponse.json(
        {
          error:
            'No se puede eliminar: tiene ventas, compras o movimientos de inventario asociados. Usa "Bloquear" en su lugar.',
        },
        { status: 409 }
      );
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo eliminar el producto" }, { status: 500 });
  }
}
