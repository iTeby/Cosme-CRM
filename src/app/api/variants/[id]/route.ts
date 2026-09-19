import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { variantUpdateSchema } from "@/lib/validation";

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageProducts")) {
    return NextResponse.json(
      { error: "No tienes permiso para editar variantes" },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Cuerpo de la petición inválido" }, { status: 400 });
  }
  const parsed = variantUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { sku, barcode, attributes, price, cost, lowStockThreshold, active } = parsed.data;
  const { tracksLots, shelfLifeDays, nearExpiryDays } = parsed.data;

  try {
    // Activar el seguimiento por lotes sobre una variante que ya tiene stock
    // dejaría ese stock fuera de todo lote: el nivel diría 40 y la suma de
    // los lotes 0, y la primera venta fallaría por falta de lotes con la
    // mercadería en la bodega. Primero se descarga, después se activa y se
    // recibe lote por lote.
    if (tracksLots === true) {
      const actual = await prisma.productVariant.findUnique({
        where: { id: params.id },
        select: { tracksLots: true, stockLevels: { select: { quantity: true } } },
      });
      const conStock = (actual?.stockLevels ?? []).some((n) => Number(n.quantity) > 0);
      if (actual && !actual.tracksLots && conStock) {
        return NextResponse.json(
          {
            error:
              "Este producto ya tiene stock sin lote. Déjalo en cero o ajústalo antes de activar el seguimiento por lotes, y después recíbelo lote por lote desde Vencimientos.",
          },
          { status: 409 }
        );
      }
    }

    const variant = await prisma.productVariant.update({
      where: { id: params.id },
      data: {
        sku,
        // "" a null a propósito: en el índice único dos cadenas vacías chocan
        // y dos NULL no. Con "" el segundo producto sin código de barras sería
        // rechazado por duplicado, que es un error incomprensible.
        barcode: barcode || null,
        attributes: attributes || null,
        price,
        cost,
        lowStockThreshold,
        active,
        // Parcial de verdad: el esquema los declara opcionales, así que un
        // cliente que edite solo el precio no puede apagar los lotes sin
        // querer.
        ...(tracksLots !== undefined ? { tracksLots } : {}),
        ...(shelfLifeDays !== undefined ? { shelfLifeDays } : {}),
        ...(nearExpiryDays !== undefined ? { nearExpiryDays } : {}),
      },
    });
    return NextResponse.json(variant);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "P2002") {
      const campos = (err as { meta?: { target?: string[] } })?.meta?.target ?? [];
      const esBarcode = campos.includes("barcode");
      return NextResponse.json(
        {
          error: esBarcode
            ? "Ya hay otro producto con ese código de barras"
            : "Ya existe una variante con ese SKU",
        },
        { status: 409 }
      );
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo actualizar la variante" }, { status: 500 });
  }
}
