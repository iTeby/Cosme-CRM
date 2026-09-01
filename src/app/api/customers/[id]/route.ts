import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { customerUpdateSchema } from "@/lib/validation";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    include: {
      sales: {
        orderBy: { createdAt: "desc" },
        include: { items: true },
      },
    },
  });

  if (!customer) {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }

  return NextResponse.json(customer);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageCustomers")) {
    return NextResponse.json(
      { error: "No tienes permiso para editar clientes" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = customerUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, taxId, phone, email, address, notes, active } = parsed.data;

  try {
    const customer = await prisma.customer.update({
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
    return NextResponse.json(customer);
  } catch {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }
}
