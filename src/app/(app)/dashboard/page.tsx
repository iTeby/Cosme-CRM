import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber } from "@/lib/utils";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  const canViewSales = can(session.user.role, "viewSales");

  const [productCount, variants, recentMovements, pendingSales] = await Promise.all([
    prisma.product.count({ where: { active: true } }),
    prisma.productVariant.findMany({
      where: { active: true },
      include: { product: true, stockLevels: true },
    }),
    prisma.stockMovement.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { variant: { include: { product: true } }, user: { select: { name: true } } },
    }),
    canViewSales
      ? prisma.sale.count({ where: { status: { in: ["PENDIENTE", "PAGADA"] } } })
      : Promise.resolve(0),
  ]);

  const totalUnits = variants.reduce(
    (sum, v) => sum + v.stockLevels.reduce((s, l) => s + l.quantity, 0),
    0
  );
  const lowStock = variants.filter((v) => {
    const total = v.stockLevels.reduce((s, l) => s + l.quantity, 0);
    return total <= v.lowStockThreshold;
  });

  const stats = [
    { label: "Productos activos", value: formatNumber(productCount) },
    { label: "Variantes / SKU", value: formatNumber(variants.length) },
    { label: "Unidades en stock", value: formatNumber(totalUnits) },
    { label: "Con stock bajo", value: formatNumber(lowStock.length), warn: lowStock.length > 0 },
    ...(canViewSales
      ? [{ label: "Ventas por entregar", value: formatNumber(pendingSales) }]
      : []),
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-brand-900">
          Hola, {session.user.name?.split(" ")[0] ?? ""}
        </h1>
        <p className="text-sm text-slate-500">Resumen general del inventario.</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="py-5">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {stat.label}
              </p>
              <p
                className={`mt-1 text-2xl font-semibold ${
                  stat.warn ? "text-amber-700" : "text-brand-900"
                }`}
              >
                {stat.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Stock bajo</CardTitle>
          </CardHeader>
          <CardContent>
            {lowStock.length === 0 ? (
              <p className="text-sm text-slate-500">Todo el inventario está sobre su umbral.</p>
            ) : (
              <ul className="space-y-2">
                {lowStock.slice(0, 8).map((v) => {
                  const total = v.stockLevels.reduce((s, l) => s + l.quantity, 0);
                  return (
                    <li key={v.id} className="flex items-center justify-between text-sm">
                      <Link
                        href={`/products/${v.product.id}`}
                        className="text-slate-700 hover:text-brand-700 hover:underline"
                      >
                        {v.product.name}{" "}
                        <span className="font-mono text-xs text-slate-400">({v.sku})</span>
                      </Link>
                      <Badge tone="warn">{formatNumber(total)} uds.</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Actividad reciente</CardTitle>
          </CardHeader>
          <CardContent>
            {recentMovements.length === 0 ? (
              <p className="text-sm text-slate-500">Aún no hay movimientos de inventario.</p>
            ) : (
              <ul className="space-y-3">
                {recentMovements.map((m) => (
                  <li key={m.id} className="text-sm">
                    <p className="text-slate-700">
                      <span className="font-medium">{m.user.name || "Alguien"}</span>{" "}
                      {m.type === "ENTRADA"
                        ? "registró una entrada de"
                        : m.type === "SALIDA"
                          ? "registró una salida de"
                          : "ajustó"}{" "}
                      {Math.abs(m.quantity)} uds. de {m.variant.product.name}
                    </p>
                    <p className="text-xs text-slate-400">{formatDate(m.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
