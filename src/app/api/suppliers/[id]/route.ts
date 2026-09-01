import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { supplierUpdateSchema } from "@/lib/validation";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const supplier = await prisma.supplier.findUnique({
    where: { id: params.id },
    include: {
      purchases: {
        orderBy: { createdAt: "desc" },
        include: { items: true },
      },
    },
  });

  if (!supplier) {
    return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
  }

  return NextResponse.json(supplier);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageSuppliers")) {
    return NextResponse.json(
      { error: "No tienes permiso para editar proveedores" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = supplierUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, taxId, phone, email, address, notes, active } = parsed.data;

  try {
    const supplier = await prisma.supplier.update({
      where: { id: params.id },
      data: {
        name,
        taxId: taxId || null,
        phone: phone || null,
        email: email || null,
        address: address || null,
        notes: notes || null,
        active,
      },
    });
    return NextResponse.json(supplier);
  } catch {
    return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
  }
}
