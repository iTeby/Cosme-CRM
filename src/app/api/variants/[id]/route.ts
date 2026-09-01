import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { variantUpdateSchema } from "@/lib/validation";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageProducts")) {
    return NextResponse.json(
      { error: "No tienes permiso para editar variantes" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = variantUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { sku, attributes, price, cost, lowStockThreshold, active } = parsed.data;

  try {
    const variant = await prisma.productVariant.update({
      where: { id: params.id },
      data: { sku, attributes: attributes || null, price, cost, lowStockThreshold, active },
    });
    return NextResponse.json(variant);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "P2002") {
      return NextResponse.json({ error: "Ya existe una variante con ese SKU" }, { status: 409 });
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo actualizar la variante" }, { status: 500 });
  }
}
