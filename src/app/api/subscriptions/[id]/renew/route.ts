import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { round2, toNumber } from "@/lib/decimal";
import { currentShift } from "@/lib/cash";
import { addOneYear } from "@/lib/subscriptions";
import { subscriptionRenewSchema } from "@/lib/validation";

const RENEWAL_SKU = "SER-91-SUS";

// Renovar: se crea la venta del año siguiente (línea "Suscripción anual" por
// el monto en pesos), la fecha de renovación avanza un año, las horas usadas
// vuelven a cero y la suscripción queda ligada a esa venta. El cobro se
// registra después, como en cualquier venta.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageSubscriptions") || !can(session.user.role, "manageSales")) {
    return NextResponse.json({ error: "No tienes permiso para renovar suscripciones" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = subscriptionRenewSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { ufValue } = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({
        where: { id: params.id },
        include: { customer: { select: { name: true } } },
      });
      if (!sub) throw new Error("NOT_FOUND");
      if (sub.status !== "ACTIVA") throw new Error("CANCELLED");
      if (sub.currency === "UF" && !ufValue) throw new Error("UF_REQUIRED");

      const variant = await tx.productVariant.findFirst({ where: { sku: RENEWAL_SKU } });
      if (!variant) throw new Error("NO_RENEWAL_ITEM");

      const warehouse = await tx.warehouse.findFirst({ where: { isDefault: true } });
      if (!warehouse) throw new Error("NO_WAREHOUSE");

      const factor = sub.currency === "UF" ? (ufValue as number) : 1;
      const monto = round2(toNumber(sub.amount) * factor);
      const nuevaFecha = addOneYear(sub.renewsAt);
      const turno = await currentShift(tx, warehouse.id);

      const sale = await tx.sale.create({
        data: {
          customerId: sub.customerId,
          warehouseId: warehouse.id,
          shiftId: turno?.id ?? null,
          createdById: session.user.id,
          notes: `Renovación ${sub.name} hasta ${nuevaFecha.toISOString().slice(0, 10)}`,
          totalAmount: monto,
          items: {
            create: [{ variantId: variant.id, quantity: 1, unitPrice: monto, subtotal: monto }],
          },
        },
      });

      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: { renewsAt: nuevaFecha, hoursUsed: 0, saleId: sale.id },
      });

      return { sale, subscription: updated };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    const conocidos: Record<string, [string, number]> = {
      NOT_FOUND: ["Suscripción no encontrada", 404],
      CANCELLED: ["La suscripción está cancelada", 409],
      UF_REQUIRED: ["Indica el valor de la UF del día", 400],
      NO_RENEWAL_ITEM: ["Falta el ítem SER-91-SUS en el catálogo", 500],
      NO_WAREHOUSE: ["No hay ninguna bodega por defecto configurada", 500],
    };
    if (conocidos[message]) {
      const [error, status] = conocidos[message];
      return NextResponse.json({ error }, { status });
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo renovar" }, { status: 500 });
  }
}
