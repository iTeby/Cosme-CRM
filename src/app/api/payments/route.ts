import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import {
  payOneSale,
  payAccount,
  OverpaymentError,
  NothingToPayError,
  ConcurrentPaymentError,
  CashWithoutShiftError,
  ShiftClosedError,
} from "@/lib/payments";
import { requireOpenShift, NoOpenShiftError } from "@/lib/cash";
import { paymentCreateSchema, primerMensaje } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "viewPayments")) {
    return NextResponse.json({ error: "No tienes permiso para ver pagos" }, { status: 403 });
  }

  const limit = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get("limit")) || 50, 200));
  const customerId = req.nextUrl.searchParams.get("customerId") ?? undefined;

  const payments = await prisma.payment.findMany({
    where: customerId ? { customerId } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      customer: { select: { name: true } },
      sale: { select: { number: true } },
      createdBy: { select: { name: true } },
    },
  });

  return NextResponse.json(payments);
}

// Registrar un abono, contra una venta o a cuenta. Toda la escritura la hace
// src/lib/payments.ts dentro de esta transacción.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "managePayments")) {
    return NextResponse.json(
      { error: "No tienes permiso para registrar pagos" },
      { status: 403 }
    );
  }

  // Fuera del try: un cuerpo malformado reventaba con SyntaxError y salía 500.
  // En una ruta de dinero eso confunde un dedazo del cliente con una caída.
  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Cuerpo de la petición inválido" }, { status: 400 });
  }
  const parsed = paymentCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: primerMensaje(parsed.error) }, { status: 400 });
  }
  const { saleId, customerId, amount, method, notes } = parsed.data;

  try {
    const resultado = await prisma.$transaction(
      async (tx) => {
        // Solo el efectivo pasa por el cajón. Débito, crédito y transferencia
        // no se cuentan a mano al cerrar, así que no exigen turno abierto.
        //
        // Acá solo se resuelve cuál es la caja; el lock lo toma payOneSale al
        // reclamarla, dentro de esta misma transacción. Con una sola bodega,
        // que es el caso hoy, ambas ramas dan la misma caja.
        let shiftId: string | null = null;
        if (method === "EFECTIVO") {
          const bodega = saleId
            ? (await tx.sale.findUnique({
                where: { id: saleId },
                select: { warehouseId: true },
              }))?.warehouseId
            : (await tx.warehouse.findFirst({ where: { isDefault: true } }))?.id;
          if (!bodega) throw new Error(saleId ? "SALE_NOT_FOUND" : "NO_WAREHOUSE");
          shiftId = await requireOpenShift(tx, bodega);
        }

        const input = { amount, method, notes, shiftId, userId: session.user.id };
        if (saleId) return [await payOneSale(tx, saleId, input)];

        const cliente = await tx.customer.findUnique({ where: { id: customerId! } });
        if (!cliente) throw new Error("CUSTOMER_NOT_FOUND");
        return payAccount(tx, customerId!, input);
      },
      // Un abono a cuenta toca una venta por cada deuda abierta, y un cliente
      // con muchas ventas pasa de largo el timeout por defecto de 5 segundos.
      { timeout: 30000, maxWait: 10000 }
    );

    return NextResponse.json(resultado, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof OverpaymentError) {
      return NextResponse.json(
        {
          error: err.saleNumber
            ? `El abono deja la venta #${err.saleNumber} pagada de más`
            : "El abono supera la deuda del cliente. Revisa el monto.",
        },
        { status: 409 }
      );
    }
    if (err instanceof ConcurrentPaymentError) {
      return NextResponse.json(
        {
          error:
            "Alguien más registró un pago de este cliente al mismo tiempo. Revisa el saldo y vuelve a intentar.",
        },
        { status: 409 }
      );
    }
    if (err instanceof ShiftClosedError) {
      return NextResponse.json(
        { error: "La caja se cerró mientras se registraba el pago. Ábrela y vuelve a cobrar." },
        { status: 409 }
      );
    }
    if (err instanceof NoOpenShiftError || err instanceof CashWithoutShiftError) {
      return NextResponse.json(
        {
          error:
            "No hay turno de caja abierto. Abre la caja antes de cobrar en efectivo.",
        },
        { status: 409 }
      );
    }
    if (err instanceof NothingToPayError) {
      return NextResponse.json(
        { error: "Este cliente no tiene ninguna venta con saldo pendiente" },
        { status: 409 }
      );
    }
    const message = err instanceof Error ? err.message : "";
    if (message === "SALE_NOT_FOUND") {
      return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
    }
    if (message === "CUSTOMER_NOT_FOUND") {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }
    if (message === "SALE_VOIDED") {
      return NextResponse.json(
        { error: "No se puede abonar a una venta anulada" },
        { status: 409 }
      );
    }
    if (message === "INVALID_AMOUNT") {
      return NextResponse.json({ error: "El monto debe ser mayor que 0" }, { status: 400 });
    }
    if (message === "NO_WAREHOUSE") {
      return NextResponse.json(
        { error: "No hay ninguna bodega por defecto configurada" },
        { status: 500 }
      );
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo registrar el pago" }, { status: 500 });
  }
}
