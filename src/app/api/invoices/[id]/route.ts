import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { invoiceUpdateSchema } from "@/lib/validation";

// Una factura no se borra: se anula. El enlace al PDF sí se puede corregir.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageInvoices")) {
    return NextResponse.json({ error: "No tienes permiso para editar facturas" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = invoiceUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { driveUrl, status } = parsed.data;

  try {
    const invoice = await prisma.invoice.update({
      where: { id: params.id },
      data: {
        ...(driveUrl !== undefined ? { driveUrl: driveUrl || null } : {}),
        ...(status ? { status } : {}),
      },
    });
    return NextResponse.json(invoice);
  } catch {
    return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  }
}
