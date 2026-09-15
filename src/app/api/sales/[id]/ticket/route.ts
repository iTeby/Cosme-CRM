import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { dteConfig } from "@/lib/dte";
import { nombreDelNegocio, respuestaImpresion, ticketVenta } from "@/lib/printing";
import { outstanding } from "@/lib/sales";
import { round2 } from "@/lib/decimal";

// Los bytes ESC/POS del comprobante de una venta.
//
// No es la boleta electrónica: es el papel que se le pasa al cliente. Si la
// venta tiene un documento emitido, se imprime su folio y, cuando el
// proveedor devuelva el timbre, el PDF417 que lo hace válido.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "viewSales")) {
    return NextResponse.json({ error: "No tienes permiso para ver ventas" }, { status: 403 });
  }

  const verPagos = can(session.user.role, "viewPayments");

  const venta = await prisma.sale.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      createdBy: { select: { name: true } },
      items: { include: { variant: { include: { product: true } } } },
      ...(verPagos ? { payments: { orderBy: { createdAt: "asc" } } } : {}),
      dtes: {
        where: { status: { in: ["ENVIADO", "ACEPTADO"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!venta) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });

  const documento = venta.dtes[0] ?? null;

  // La deuda total del cliente se imprime solo si quien imprime puede verla.
  let deudaTotal: number | undefined;
  if (verPagos) {
    const abiertas = await prisma.sale.findMany({
      where: { customerId: venta.customerId, status: { not: "ANULADA" } },
      select: { totalAmount: true, paidAmount: true },
    });
    deudaTotal = round2(
      abiertas.reduce((acc, v) => acc + outstanding(v.totalAmount, v.paidAmount), 0)
    );
  }

  const bytes = ticketVenta({
    negocio: nombreDelNegocio(),
    numero: venta.number,
    fecha: venta.createdAt,
    cajero: venta.createdBy.name,
    cliente: { nombre: venta.customer.name, deudaTotal },
    lineas: venta.items.map((item) => ({
      nombre: item.variant.product.name,
      cantidad: item.quantity,
      unidad: item.variant.unit,
      precioUnitario: item.unitPrice,
      subtotal: item.subtotal,
    })),
    total: venta.totalAmount,
    pagado: verPagos ? venta.paidAmount : venta.totalAmount,
    pagos: verPagos
      ? (venta.payments ?? []).map((pago) => ({ metodo: pago.method, monto: pago.amount }))
      : [],
    folio: documento?.folio ?? null,
    // El timbre solo existe si el proveedor lo devolvió; hoy no llega.
    timbre: null,
    ambienteCertificacion: (documento?.environment ?? dteConfig().environment) === "CERTIFICACION",
  });

  return respuestaImpresion(bytes, `venta-${venta.number}.bin`);
}
