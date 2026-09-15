import type { Prisma, PrismaClient } from "@prisma/client";
import { round2, toNumber } from "./decimal";

// El Diagnóstico Técnico ($80.000) se descuenta de cualquier proyecto
// posterior del mismo cliente. El crédito nace cuando la venta del
// Diagnóstico queda pagada y se consume una sola vez, al convertir una
// cotización en venta (ver /api/quotes/[id]/convert).
export const DIAGNOSTIC_SKU = "SER-01-DIAG";

type Db = PrismaClient | Prisma.TransactionClient;

export type DiagnosticCredit = { amount: number; saleId: string | null };

/** Crédito disponible hoy: la venta pagada del Diagnóstico que aún no se descontó. */
export async function availableDiagnosticCredit(db: Db, customerId: string): Promise<DiagnosticCredit> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { diagnosticCreditUsedAt: true },
  });
  if (!customer || customer.diagnosticCreditUsedAt) return { amount: 0, saleId: null };

  const ventas = await db.sale.findMany({
    where: {
      customerId,
      status: { not: "ANULADA" },
      items: { some: { variant: { sku: DIAGNOSTIC_SKU } } },
    },
    include: { items: { include: { variant: { select: { sku: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  for (const venta of ventas) {
    const pagada = toNumber(venta.paidAmount) >= toNumber(venta.totalAmount) && toNumber(venta.totalAmount) > 0;
    if (!pagada) continue;
    const monto = venta.items
      .filter((i) => i.variant.sku === DIAGNOSTIC_SKU)
      .reduce((acc, i) => acc + toNumber(i.subtotal), 0);
    if (monto > 0) return { amount: round2(monto), saleId: venta.id };
  }
  return { amount: 0, saleId: null };
}
