import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { canTransitionSale } from "@/lib/sales";
import { applyMovement } from "@/lib/inventory";
import { toNumber } from "@/lib/decimal";
import { saleStatusUpdateSchema } from "@/lib/validation";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageSales")) {
    return NextResponse.json(
      { error: "No tienes permiso para cambiar el estado de una venta" },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Cuerpo de la petición inválido" }, { status: 400 });
  }
  const parsed = saleStatusUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { status: nextStatus } = parsed.data;

  try {
    const sale = await prisma.$transaction(async (tx) => {
      const current = await tx.sale.findUnique({
        where: { id: params.id },
        include: { items: true },
      });
      if (!current) throw new Error("SALE_NOT_FOUND");

      if (!canTransitionSale(current.status, nextStatus)) {
        throw new Error("INVALID_TRANSITION");
      }

      // El cambio de estado se hace acá, condicionado al estado que acabamos de
      // leer, y no al final. Sin esto, dos peticiones simultáneas —un doble
      // click con la red lenta— leerían ambas PENDIENTE, ambas pasarían la
      // validación y ambas revertirían el stock: el inventario quedaría con el
      // doble de unidades y dos movimientos legítimos respaldándolo. Con el
      // WHERE por estado, la segunda no afecta ninguna fila y se aborta.
      const claimed = await tx.sale.updateMany({
        where: { id: params.id, status: current.status },
        data: { status: nextStatus },
      });

      if (claimed.count === 0) throw new Error("CONCURRENT_UPDATE");

      // Anular una venta con plata recibida dejaría los abonos apuntando a un
      // documento muerto y el saldo del cliente mentiría, así que se revisa.
      //
      // Y se revisa DESPUÉS del updateMany, en un statement aparte, no como
      // condición del WHERE. En READ COMMITTED, cuando un UPDATE se queda
      // esperando el lock de una fila, Postgres reevalúa el WHERE contra la
      // versión nueva de esa fila, pero las subconsultas a otras tablas siguen
      // viéndose con el snapshot viejo de la transacción. O sea: un abono que
      // commiteara justo mientras esperábamos el lock no aparecería en un
      // `payments: { none: {} }` puesto en el WHERE, y la venta se anularía
      // igual con la plata adentro. Acá ya tenemos el lock de la venta: un
      // pago concurrente o commiteó antes (y este count lo ve, porque es un
      // statement nuevo con snapshot nuevo) o está bloqueado detrás nuestro y
      // al despertar encontrará la venta ANULADA y se abortará solo.
      //
      // Se pregunta por los pagos mismos y no por paidAmount: si el snapshot
      // se despegara alguna vez, mirarlo dejaría anular una venta con abonos.
      if (nextStatus === "ANULADA") {
        const conPagos = await tx.payment.count({ where: { saleId: params.id } });
        if (conPagos > 0) throw new Error("SALE_HAS_PAYMENTS");

        // Y tampoco si ya hay una boleta declarada ante el SII. Anular la
        // venta acá no la hace desaparecer allá: el documento sigue existiendo
        // y solo se deshace con nota de crédito. Dejar anular dejaba al
        // sistema afirmando que la venta no ocurrió mientras el SII tiene la
        // boleta que dice que sí.
        const conDte = await tx.dte.count({
          where: { saleId: params.id, status: { in: ["ENVIADO", "ACEPTADO"] } },
        });
        if (conDte > 0) throw new Error("SALE_HAS_DTE");
      }

      // Al anular se revierte el stock que la venta había descontado, en la
      // misma transacción que el cambio de estado.
      //
      // Se reversa contra los MOVIMIENTOS, no contra las líneas de la venta.
      // Con lotes es la única forma correcta: una línea de 5 unidades puede
      // haber salido de dos tandas distintas, y devolverlas todas a una sola
      // dejaría un lote con más de lo que entregó y otro con menos. Además
      // así la devolución es exactamente lo que salió, aunque la línea se
      // hubiera despachado en varios pedazos.
      if (nextStatus === "ANULADA") {
        const salidas = await tx.stockMovement.findMany({
          where: { saleId: params.id, type: "SALIDA" },
          select: { variantId: true, warehouseId: true, quantity: true, lotId: true },
        });

        for (const salida of salidas) {
          await applyMovement(tx, {
            variantId: salida.variantId,
            warehouseId: salida.warehouseId,
            type: "ENTRADA",
            delta: -toNumber(salida.quantity),
            reason: `Anulación de venta #${current.number}`,
            userId: session.user.id,
            saleId: current.id,
            lotId: salida.lotId,
          });
        }
      }

      return tx.sale.findUniqueOrThrow({
        where: { id: params.id },
        include: { customer: true, items: { include: { variant: { include: { product: true } } } } },
      });
    });

    return NextResponse.json(sale);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message === "SALE_NOT_FOUND") {
      return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
    }
    if (message === "INVALID_TRANSITION") {
      return NextResponse.json(
        { error: "Ese cambio de estado no está permitido" },
        { status: 409 }
      );
    }
    if (message === "SALE_HAS_PAYMENTS") {
      return NextResponse.json(
        {
          error:
            "Esta venta tiene pagos registrados. Deshaz los abonos antes de anularla.",
        },
        { status: 409 }
      );
    }
    if (message === "SALE_HAS_DTE") {
      return NextResponse.json(
        {
          error:
            "Esta venta tiene una boleta emitida ante el SII. Anularla exige una nota de crédito, no se puede deshacer desde acá.",
        },
        { status: 409 }
      );
    }
    if (message === "CONCURRENT_UPDATE") {
      return NextResponse.json(
        { error: "Alguien más cambió el estado de esta venta. Recarga y vuelve a intentar." },
        { status: 409 }
      );
    }
    console.error(err);
    return NextResponse.json(
      { error: "No se pudo actualizar el estado de la venta" },
      { status: 500 }
    );
  }
}
