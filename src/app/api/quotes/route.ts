import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { round2 } from "@/lib/decimal";
import { quoteCreateSchema } from "@/lib/validation";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "viewQuotes")) {
    return NextResponse.json({ error: "No tienes permiso para ver cotizaciones" }, { status: 403 });
  }

  const quotes = await prisma.quote.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { name: true } },
      createdBy: { select: { name: true } },
      items: { select: { quantity: true } },
    },
  });

  return NextResponse.json(quotes);
}

// Una cotización no toca stock ni caja: es una propuesta. Se guarda con sus
// líneas y el total, y recién al aceptarse se convierte en venta.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageQuotes")) {
    return NextResponse.json({ error: "No tienes permiso para cotizar" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Cuerpo de la petición inválido" }, { status: 400 });
  }
  const parsed = quoteCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { customerId, currency, validUntil, notes, items } = parsed.data;

  try {
    const quote = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

      const variantIds = Array.from(new Set(items.map((i) => i.variantId)));
      const variants = await tx.productVariant.findMany({ where: { id: { in: variantIds } } });
      if (variants.length !== variantIds.length) throw new Error("VARIANT_NOT_FOUND");

      const subtotales = items.map((item) => round2(item.quantity * item.unitPrice));
      const totalAmount = round2(subtotales.reduce((acc, n) => acc + n, 0));

      const created = await tx.quote.create({
        data: {
          customerId,
          currency,
          validUntil,
          notes: notes || null,
          totalAmount,
          createdById: session.user.id,
          items: {
            create: items.map((item, index) => ({
              variantId: item.variantId,
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              subtotal: subtotales[index],
            })),
          },
        },
      });

      return tx.quote.findUniqueOrThrow({
        where: { id: created.id },
        include: { items: true, customer: true },
      });
    });

    return NextResponse.json(quote, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message === "CUSTOMER_NOT_FOUND") {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }
    if (message === "VARIANT_NOT_FOUND") {
      return NextResponse.json({ error: "Ítem del catálogo no encontrado" }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo guardar la cotización" }, { status: 500 });
  }
}
