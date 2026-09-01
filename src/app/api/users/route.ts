import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { hash } from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { userCreateSchema } from "@/lib/validation";

const publicSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
} as const;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageUsers")) {
    return NextResponse.json({ error: "No tienes permiso para ver usuarios" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: publicSelect,
  });

  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageUsers")) {
    return NextResponse.json(
      { error: "No tienes permiso para crear usuarios" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = userCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, email, password, role } = parsed.data;

  try {
    const passwordHash = await hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, passwordHash, role },
      select: publicSelect,
    });
    return NextResponse.json(user, { status: 201 });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "P2002") {
      return NextResponse.json(
        { error: "Ya existe un usuario con ese correo" },
        { status: 409 }
      );
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo crear el usuario" }, { status: 500 });
  }
}
