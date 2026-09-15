import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { InsufficientStockError } from "@/lib/inventory";
import { LotNotAvailableError, recibirLote } from "@/lib/lots";
import { lotReceiveSchema, primerMensaje } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "viewCatalog")) {
    return NextResponse.json({ error: "No tienes permiso para ver el catálogo" }, { status: 403 });
  }

  const variantId = req.nextUrl.searchParams.get("variantId") ?? undefined;
  const soloConStock = req.nextUrl.searchParams.get("conStock") !== "false";

  const lotes = await prisma.lot.findMany({
    where: {
      ...(variantId ? { variantId } : {}),
      ...(soloConStock ? { quantity: { gt: 0 } } : {}),
    },
    // Los que vencen primero arriba: la pantalla es una lista de pendientes,
    // no un catálogo.
    orderBy: [{ expiresAt: "asc" }, { receivedAt: "asc" }],
    take: 300,
    include: {
      // select y no include: `include: { product: true }` devolvería todos
      // los escalares de la variante, costo incluido, y el costo tiene su
      // propio permiso.
      variant: {
        select: {
          id: true,
          sku: true,
          unit: true,
          nearExpiryDays: true,
          product: { select: { name: true } },
        },
      },
      warehouse: { select: { name: true } },
    },
  });

  return NextResponse.json(lotes);
}

// Ingresar mercadería a un lote. Crea el lote si es la primera vez y suma si
// ya existe: la misma tanda en dos entregas sigue siendo una sola tanda.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageStock")) {
    return NextResponse.json({ error: "No tienes permiso para mover inventario" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Cuerpo de la petición inválido" }, { status: 400 });
  }
  const parsed = lotReceiveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: primerMensaje(parsed.error) }, { status: 400 });
  }
  const { variantId, warehouseId, code, quantity, expiresAt, notes } = parsed.data;

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      const bodega = warehouseId
        ? await tx.warehouse.findUnique({ where: { id: warehouseId } })
        : await tx.warehouse.findFirst({ where: { isDefault: true } });
      if (!bodega) throw new Error("NO_WAREHOUSE");

      const variante = await tx.productVariant.findUnique({
        where: { id: variantId },
        select: { id: true, tracksLots: true },
      });
      if (!variante) throw new Error("VARIANT_NOT_FOUND");
      // La divergencia inversa: recibir un lote de algo que no se maneja por
      // lotes haría subir el lote y nunca bajarlo, porque la venta no pasa
      // por FEFO.
      if (!variante.tracksLots) throw new Error("VARIANT_WITHOUT_LOTS");

      return recibirLote(tx, {
        variantId,
        warehouseId: bodega.id,
        code,
        cantidad: quantity,
        // La fecha se arma en UTC a mediodía: con medianoche local, un
        // vencimiento puede caer el día anterior al compararlo.
        expiresAt: expiresAt ? new Date(`${expiresAt}T12:00:00.000Z`) : null,
        notes: notes || null,
        userId: session.user.id,
      });
    });

    return NextResponse.json(resultado.lote, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof LotNotAvailableError) {
      return NextResponse.json(
        { error: "Ese lote está bloqueado o vencido. Desbloquéalo antes de recibir más." },
        { status: 409 }
      );
    }
    if (err instanceof InsufficientStockError) {
      return NextResponse.json({ error: "El stock quedaría negativo" }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "";
    if (message === "LOT_EXPIRY_MISMATCH") {
      return NextResponse.json(
        {
          error:
            "Ese número de lote ya existe con otro vencimiento. O es un error de tipeo, o no es el mismo lote: revísalo antes de seguir.",
        },
        { status: 409 }
      );
    }
    if (message === "LOT_CODE_REQUIRED") {
      return NextResponse.json({ error: "El lote necesita un número" }, { status: 400 });
    }
    if (message === "VARIANT_WITHOUT_LOTS") {
      return NextResponse.json(
        {
          error:
            "Ese producto no se maneja por lotes. Actívalo en su ficha antes de recibir lotes, o la venta no los descontaría.",
        },
        { status: 409 }
      );
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
    return NextResponse.json({ error: "No se pudo recibir el lote" }, { status: 500 });
  }
}
