import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { hash } from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { userUpdateSchema } from "@/lib/validation";

const publicSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
} as const;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageUsers")) {
    return NextResponse.json(
      { error: "No tienes permiso para editar usuarios" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = userUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, role, active, password } = parsed.data;

  // Salvavidas: que un admin no se bloquee a sí mismo por accidente.
  if (params.id === session.user.id) {
    if (!active) {
      return NextResponse.json(
        { error: "No puedes desactivar tu propia cuenta" },
        { status: 400 }
      );
    }
    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "No puedes quitarte a ti mismo el rol de administrador" },
        { status: 400 }
      );
    }
  }

  try {
    const data: {
      name: string;
      role: typeof role;
      active: boolean;
      passwordHash?: string;
    } = { name, role, active };

    if (password) {
      data.passwordHash = await hash(password, 10);
    }

    const user = await prisma.user.update({
      where: { id: params.id },
      data,
      select: publicSelect,
    });
    return NextResponse.json(user);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "P2025") {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo actualizar el usuario" }, { status: 500 });
  }
}
