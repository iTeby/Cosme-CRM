import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "viewPurchases")) {
    return NextResponse.json({ error: "No tienes permiso para ver compras" }, { status: 403 });
  }

  const purchase = await prisma.purchase.findUnique({
    where: { id: params.id },
    include: {
      supplier: true,
      createdBy: { select: { name: true } },
      items: { include: { variant: { include: { product: true } } } },
    },
  });

  if (!purchase) {
    return NextResponse.json({ error: "Compra no encontrada" }, { status: 404 });
  }

  return NextResponse.json(purchase);
}
