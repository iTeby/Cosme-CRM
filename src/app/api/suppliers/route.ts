import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { supplierCreateSchema } from "@/lib/validation";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { purchases: true } } },
  });

  return NextResponse.json(suppliers);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageSuppliers")) {
    return NextResponse.json(
      { error: "No tienes permiso para crear proveedores" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = supplierCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, taxId, phone, email, address, notes } = parsed.data;

  const supplier = await prisma.supplier.create({
    data: {
      name,
      taxId: taxId || null,
      phone: phone || null,
      email: email || null,
      address: address || null,
      notes: notes || null,
    },
  });

  return NextResponse.json(supplier, { status: 201 });
}
