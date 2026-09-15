import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { customerCreateSchema } from "@/lib/validation";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageCustomers")) {
    return NextResponse.json({ error: "No tienes permiso para ver clientes" }, { status: 403 });
  }

  const customers = await prisma.customer.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { sales: true } } },
  });

  return NextResponse.json(customers);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageCustomers")) {
    return NextResponse.json(
      { error: "No tienes permiso para crear clientes" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = customerCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, contactName, stage, source, nextContactAt, taxId, phone, email, address, notes } =
    parsed.data;

  const customer = await prisma.customer.create({
    data: {
      name,
      contactName: contactName || null,
      stage,
      source: source || null,
      nextContactAt,
      taxId: taxId || null,
      phone: phone || null,
      email: email || null,
      address: address || null,
      notes: notes || null,
    },
  });

  return NextResponse.json(customer, { status: 201 });
}
