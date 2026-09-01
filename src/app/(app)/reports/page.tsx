import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { saleStatusLabels, type SaleStatus } from "@/lib/sales";
import { ReportsCharts } from "@/components/reports-charts";

// Todas las consultas de esta página son de solo lectura y se calculan al
// vuelo desde las tablas existentes (Sale, StockMovement, StockLevel) — no
// se guarda ningún dato nuevo, así que no hay migración asociada.
const STATUS_ORDER: SaleStatus[] = ["PENDIENTE", "PAGADA", "ENTREGADA", "ANULADA"];

export default async function ReportsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "viewReports")) {
    redirect("/dashboard");
  }

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [salesByStatusRaw, monthlySalesRaw, warehouses, movementsByWarehouse, stockLevels] =
    await Promise.all([
      prisma.sale.groupBy({
        by: ["status"],
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      prisma.$queryRaw<{ month: Date; count: bigint; total: string }[]>`
        SELECT date_trunc('month', "createdAt") AS month,
               COUNT(*)::int AS count,
               COALESCE(SUM("totalAmount"), 0) AS total
        FROM sales
        WHERE status != 'ANULADA' AND "createdAt" >= ${sixMonthsAgo}
        GROUP BY 1
        ORDER BY 1
      `,
      prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.stockMovement.groupBy({
        by: ["warehouseId", "type"],
        _sum: { quantity: true },
        where: { createdAt: { gte: thirtyDaysAgo } },
      }),
      prisma.stockLevel.findMany({
        where: { variant: { active: true, product: { active: true } } },
        include: { variant: { include: { product: true } } },
      }),
    ]);

  // --- Ventas por estado ---
  const salesByStatusMap = new Map(salesByStatusRaw.map((s) => [s.status, s]));
  const salesByStatus = STATUS_ORDER.map((status) => {
    const row = salesByStatusMap.get(status);
    return {
      status,
      label: saleStatusLabels[status],
      count: row?._count._all ?? 0,
      total: row ? Number(row._sum.totalAmount ?? 0) : 0,
    };
  });

  // --- Ventas realizadas por mes (últimos 6 meses, sin contar anuladas) ---
  const monthlyByKey = new Map(
    monthlySalesRaw.map((r) => [
      `${r.month.getFullYear()}-${r.month.getMonth()}`,
      { total: Number(r.total), count: Number(r.count) },
    ])
  );
  const monthlySales = Array.from({ length: 6 }).map((_, i) => {
    const d = new Date(sixMonthsAgo);
    d.setMonth(d.getMonth() + i);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const found = monthlyByKey.get(key);
    return {
      label: new Intl.DateTimeFormat("es-CL", { month: "short", year: "2-digit" }).format(d),
      total: found?.total ?? 0,
      count: found?.count ?? 0,
    };
  });

  // --- Uso de bodega (entradas vs. salidas, últimos 30 días) ---
  const warehouseUsageMap = new Map(
    warehouses.map((w) => [w.id, { name: w.name, entradas: 0, salidas: 0 }])
  );
  for (const row of movementsByWarehouse) {
    const entry = warehouseUsageMap.get(row.warehouseId);
    if (!entry) continue;
    const total = Math.abs(row._sum.quantity ?? 0);
    if (row.type === "ENTRADA") entry.entradas += total;
    else if (row.type === "SALIDA") entry.salidas += total;
  }
  const warehouseUsage = Array.from(warehouseUsageMap.values());

  // --- Stock por categoría y productos con stock crítico ---
  const categoryTotals = new Map<string, number>();
  const variantTotals = new Map<
    string,
    { name: string; sku: string; quantity: number; threshold: number }
  >();
  for (const level of stockLevels) {
    const category = level.variant.product.category || "Sin categoría";
    categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + level.quantity);

    const existing = variantTotals.get(level.variantId);
    if (existing) {
      existing.quantity += level.quantity;
    } else {
      variantTotals.set(level.variantId, {
        name: level.variant.product.name,
        sku: level.variant.sku,
        quantity: level.quantity,
        threshold: level.variant.lowStockThreshold,
      });
    }
  }
  const stockByCategory = Array.from(categoryTotals.entries()).map(([category, units]) => ({
    category,
    units,
  }));
  const lowStockItems = Array.from(variantTotals.values())
    .filter((v) => v.quantity <= v.threshold)
    .sort((a, b) => (a.quantity - a.threshold) - (b.quantity - b.threshold))
    .slice(0, 10);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-brand-900">Reportes</h1>
        <p className="text-sm text-slate-500">
          Vista general de ventas, uso de bodega y stock.
        </p>
      </div>
      <ReportsCharts
        salesByStatus={salesByStatus}
        monthlySales={monthlySales}
        warehouseUsage={warehouseUsage}
        stockByCategory={stockByCategory}
        lowStockItems={lowStockItems}
      />
    </div>
  );
}
