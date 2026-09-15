import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { invoiceCreateSchema } from "@/lib/validation";
import { taxFor } from "@/lib/invoices";
import { round2 } from "@/lib/decimal";

// Registrar una factura emitida en el SII. El CRM no emite: anota folio,
// montos y enlace al PDF. El IVA se calcula acá para que nadie lo tipee mal.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageInvoices")) {
    return NextResponse.json({ error: "No tienes permiso para registrar facturas" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = invoiceCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { saleId, number, issuedAt, netAmount, driveUrl, notes } = parsed.data;

  const sale = await prisma.sale.findUnique({ where: { id: saleId }, select: { id: true, status: true } });
  if (!sale) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
  if (sale.status === "ANULADA") {
    return NextResponse.json({ error: "No se factura una venta anulada" }, { status: 400 });
  }

  const taxAmount = taxFor(netAmount);
  try {
    const invoice = await prisma.invoice.create({
      data: {
        saleId,
        number,
        issuedAt,
        netAmount: round2(netAmount),
        taxAmount,
        totalAmount: round2(netAmount + taxAmount),
        driveUrl: driveUrl || null,
        notes: notes || null,
        createdById: session.user.id,
      },
    });
    return NextResponse.json(invoice, { status: 201 });
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: `Ya existe una factura con el folio ${number}` }, { status: 409 });
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo registrar la factura" }, { status: 500 });
  }
}
