import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { applyMovement, InsufficientStockError } from "@/lib/inventory";
import { consumirFefo, InsufficientLotStockError } from "@/lib/lots";
import { round2, toNumber } from "@/lib/decimal";
import { currentShift } from "@/lib/cash";
import { availableDiagnosticCredit } from "@/lib/diagnostic-credit";
import { quoteConvertSchema } from "@/lib/validation";

// Aceptar una cotización la convierte en venta, en una sola transacción:
// se crea la venta en pesos (una cotización en UF se pasa a CLP con el valor
// del día), se descuenta stock solo de las líneas que lo llevan, se aplica el
// crédito de Diagnóstico si corresponde, la cotización queda ACEPTADA y ligada
// a la venta, y el interesado pasa a CLIENTE.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageSales") || !can(session.user.role, "manageQuotes")) {
    return NextResponse.json({ error: "No tienes permiso para convertir cotizaciones" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = quoteConvertSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { purchaseOrder, ufValue, applyCredit } = parsed.data;

  try {
    const sale = await prisma.$transaction(async (tx) => {
      const quote = await tx.quote.findUnique({
        where: { id: params.id },
        include: { items: { include: { variant: true } } },
      });
      if (!quote) throw new Error("QUOTE_NOT_FOUND");
      if (quote.status === "ACEPTADA") throw new Error("ALREADY_ACCEPTED");
      if (quote.status === "RECHAZADA") throw new Error("REJECTED");
      if (quote.currency === "UF" && !ufValue) throw new Error("UF_REQUIRED");

      const warehouse = await tx.warehouse.findFirst({ where: { isDefault: true } });
      if (!warehouse) throw new Error("NO_WAREHOUSE");

      const factor = quote.currency === "UF" ? (ufValue as number) : 1;
      const lineas = quote.items.map((item) => {
        const unitPrice = round2(toNumber(item.unitPrice) * factor);
        return { item, unitPrice, subtotal: round2(toNumber(item.quantity) * unitPrice) };
      });
      const bruto = round2(lineas.reduce((acc, l) => acc + l.subtotal, 0));

      let discountAmount = 0;
      if (applyCredit) {
        const credit = await availableDiagnosticCredit(tx, quote.customerId);
        discountAmount = Math.min(credit.amount, bruto);
      }
      const totalAmount = round2(bruto - discountAmount);

      const turno = await currentShift(tx, warehouse.id);

      const created = await tx.sale.create({
        data: {
          customerId: quote.customerId,
          warehouseId: warehouse.id,
          shiftId: turno?.id ?? null,
          createdById: session.user.id,
          purchaseOrder: purchaseOrder || null,
          notes: quote.notes ? `Cotización #${quote.number}. ${quote.notes}` : `Cotización #${quote.number}`,
          discountAmount,
          totalAmount,
        },
      });

      for (const { item, unitPrice, subtotal } of lineas) {
        await tx.saleItem.create({
          data: {
            saleId: created.id,
            variantId: item.variantId,
            quantity: item.quantity,
            unitPrice,
            subtotal,
          },
        });

        if (!item.variant.tracksStock) continue;

        const cantidad = toNumber(item.quantity);
        if (item.variant.tracksLots) {
          await consumirFefo(tx, {
            variantId: item.variantId,
            warehouseId: warehouse.id,
            cantidad,
            type: "SALIDA",
            reason: `Venta #${created.number}`,
            userId: session.user.id,
            saleId: created.id,
            sku: item.variant.sku,
          });
        } else {
          await applyMovement(tx, {
            variantId: item.variantId,
            warehouseId: warehouse.id,
            type: "SALIDA",
            delta: -cantidad,
            reason: `Venta #${created.number}`,
            userId: session.user.id,
            saleId: created.id,
            sku: item.variant.sku,
          });
        }
      }

      await tx.quote.update({
        where: { id: quote.id },
        data: {
          status: "ACEPTADA",
          acceptedAt: new Date(),
          saleId: created.id,
          ufValue: quote.currency === "UF" ? ufValue : null,
        },
      });

      await tx.customer.update({
        where: { id: quote.customerId },
        data: {
          stage: "CLIENTE",
          ...(discountAmount > 0 ? { diagnosticCreditUsedAt: new Date() } : {}),
        },
      });

      return tx.sale.findUniqueOrThrow({ where: { id: created.id } });
    });

    return NextResponse.json(sale, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof InsufficientLotStockError) {
      return NextResponse.json(
        { error: err.sku ? `No hay lotes vigentes suficientes del SKU ${err.sku}` : "No hay lotes vigentes suficientes" },
        { status: 409 }
      );
    }
    if (err instanceof InsufficientStockError) {
      return NextResponse.json({ error: `No hay stock suficiente para el SKU ${err.sku}` }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "";
    const conocidos: Record<string, [string, number]> = {
      QUOTE_NOT_FOUND: ["Cotización no encontrada", 404],
      ALREADY_ACCEPTED: ["Esta cotización ya se convirtió en venta", 409],
      REJECTED: ["Una cotización rechazada no se convierte; vuélvela a borrador primero", 409],
      UF_REQUIRED: ["Indica el valor de la UF del día para convertir", 400],
      NO_WAREHOUSE: ["No hay ninguna bodega por defecto configurada", 500],
    };
    if (conocidos[message]) {
      const [error, status] = conocidos[message];
      return NextResponse.json({ error }, { status });
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo convertir la cotización" }, { status: 500 });
  }
}
