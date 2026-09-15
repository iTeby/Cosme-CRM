import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { applyMovement, InsufficientStockError } from "@/lib/inventory";
import { consumirFefo, InsufficientLotStockError } from "@/lib/lots";
import { round2 } from "@/lib/decimal";
import { currentShift } from "@/lib/cash";
import { saleCreateSchema } from "@/lib/validation";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "viewSales")) {
    return NextResponse.json({ error: "No tienes permiso para ver ventas" }, { status: 403 });
  }

  const sales = await prisma.sale.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { name: true } },
      createdBy: { select: { name: true } },
      items: { select: { quantity: true } },
    },
  });

  return NextResponse.json(sales);
}

// Registrar una venta descuenta stock automáticamente: por cada línea se aplica
// un movimiento de SALIDA dentro de la misma transacción que la venta, así que
// nunca queda una venta registrada sin su correspondiente salida de stock (y
// viceversa). Si no hay stock suficiente para alguna línea, se aborta todo.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageSales")) {
    return NextResponse.json(
      { error: "No tienes permiso para registrar ventas" },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Cuerpo de la petición inválido" }, { status: 400 });
  }
  const parsed = saleCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { customerId, notes, items } = parsed.data;

  try {
    const sale = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

      const warehouse = await tx.warehouse.findFirst({ where: { isDefault: true } });
      if (!warehouse) throw new Error("NO_WAREHOUSE");

      // Cada subtotal se redondea antes de guardarlo, porque Postgres lo va a
      // redondear igual al escribirlo en Decimal(12,2). Si el total se sumara
      // sin redondear, 0,125 kg x $1.995 dos veces daría 498,75 en la cabecera
      // y 498,76 sumando las líneas: la venta no cuadraría consigo misma y el
      // control de sobrepago de payOneSale() validaría contra el total malo.
      const subtotales = items.map((item) => round2(item.quantity * item.unitPrice));
      const totalAmount = round2(subtotales.reduce((acc, n) => acc + n, 0));

      // La venta se ata al turno abierto si lo hay, y no se bloquea si no lo
      // hay: una venta fiada no toca el cajón. El turno solo es obligatorio
      // para cobrar en efectivo, que es lo que después hay que contar.
      //
      // Esto es una lectura sin lock, a diferencia de los cobros: si el turno
      // se cierra justo entremedio, la venta queda atada a un turno recién
      // cerrado. Es aceptable porque el arqueo suma pagos, no ventas, así que
      // no mueve un peso: solo desplaza el conteo de ventas del turno. Si
      // algún día un reporte de caja dependiera de ese conteo, hay que
      // reclamar el turno acá igual que hace payOneSale.
      const turno = await currentShift(tx, warehouse.id);

      const created = await tx.sale.create({
        data: {
          customerId,
          warehouseId: warehouse.id,
          shiftId: turno?.id ?? null,
          createdById: session.user.id,
          notes: notes || null,
          totalAmount,
        },
      });

      for (const [index, item] of items.entries()) {
        const variant = await tx.productVariant.findUnique({ where: { id: item.variantId } });
        if (!variant) throw new Error("VARIANT_NOT_FOUND");

        await tx.saleItem.create({
          data: {
            saleId: created.id,
            variantId: item.variantId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: subtotales[index],
          },
        });

        if (variant.tracksLots) {
          // Sale primero lo que vence primero. Escribe un movimiento por
          // lote tocado, así el historial dice de qué tanda salió cada
          // unidad: eso es lo que permite rastrear hacia atrás si algo sale
          // mal con un lote.
          await consumirFefo(tx, {
            variantId: item.variantId,
            warehouseId: warehouse.id,
            cantidad: item.quantity,
            type: "SALIDA",
            reason: `Venta #${created.number}`,
            userId: session.user.id,
            saleId: created.id,
            sku: variant.sku,
          });
        } else {
          // La mayoría del almacén no vence en un plazo que importe y no
          // lleva lote: un movimiento y listo.
          await applyMovement(tx, {
            variantId: item.variantId,
            warehouseId: warehouse.id,
            type: "SALIDA",
            delta: -item.quantity,
            reason: `Venta #${created.number}`,
            userId: session.user.id,
            saleId: created.id,
            sku: variant.sku,
          });
        }
      }

      return tx.sale.findUniqueOrThrow({
        where: { id: created.id },
        include: { items: { include: { variant: true } }, customer: true },
      });
    });

    return NextResponse.json(sale, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof InsufficientLotStockError) {
      return NextResponse.json(
        {
          error: err.sku
            ? `No hay lotes vigentes suficientes del SKU ${err.sku}. Puede haber stock vencido o bloqueado.`
            : "No hay lotes vigentes suficientes",
        },
        { status: 409 }
      );
    }
    if (err instanceof InsufficientStockError) {
      return NextResponse.json(
        { error: `No hay stock suficiente para el SKU ${err.sku}` },
        { status: 409 }
      );
    }
    const message = err instanceof Error ? err.message : "";
    if (message === "CUSTOMER_NOT_FOUND") {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }
    if (message === "VARIANT_NOT_FOUND") {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }
    if (message === "NO_WAREHOUSE") {
      return NextResponse.json(
        { error: "No hay ninguna bodega por defecto configurada" },
        { status: 500 }
      );
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo registrar la venta" }, { status: 500 });
  }
}
