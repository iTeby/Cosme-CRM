import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import {
  etiquetaProductoEscPos,
  etiquetaProductoZpl,
  respuestaImpresion,
  respuestaTexto,
} from "@/lib/printing";

// La etiqueta de góndola de una variante, en el lenguaje de la etiquetadora
// que haya: ZPL para una Zebra, ESC/POS para la impresora de boletas.
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "viewCatalog")) {
    return NextResponse.json({ error: "No tienes permiso para ver el catálogo" }, { status: 403 });
  }

  const variante = await prisma.productVariant.findUnique({
    where: { id: params.id },
    include: { product: true },
  });
  if (!variante) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  const formato = (req.nextUrl.searchParams.get("formato") ?? "zpl").toLowerCase();
  const copias = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get("copias")) || 1, 50));

  const datos = {
    sku: variante.sku,
    barcode: variante.barcode,
    nombre: variante.product.name,
    precio: variante.price,
    unidad: variante.unit,
  };

  if (formato === "escpos") {
    return respuestaImpresion(etiquetaProductoEscPos(datos), `etiqueta-${variante.sku}.bin`);
  }

  const dpi = req.nextUrl.searchParams.get("dpi") === "300" ? 300 : 203;
  return respuestaTexto(
    etiquetaProductoZpl(datos, { copias, dpi }),
    `etiqueta-${variante.sku}.zpl`
  );
}
