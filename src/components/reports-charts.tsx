"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatNumber } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  PENDIENTE: "#f59e0b",
  PAGADA: "#1f2f45",
  ENTREGADA: "#10b981",
  ANULADA: "#ef4444",
};

const CATEGORY_COLORS = [
  "#1f2f45",
  "#10b981",
  "#f59e0b",
  "#0ea5e9",
  "#a855f7",
  "#ef4444",
  "#64748b",
];

const axisTick = { fontSize: 12, fill: "#64748b" };

type SalesByStatus = { status: string; label: string; count: number; total: number }[];
type MonthlySales = { label: string; total: number; count: number }[];
type WarehouseUsage = { name: string; entradas: number; salidas: number }[];
type StockByCategory = { category: string; units: number }[];
type LowStockItems = { name: string; sku: string; quantity: number; threshold: number }[];

export function ReportsCharts({
  salesByStatus,
  monthlySales,
  warehouseUsage,
  stockByCategory,
  lowStockItems,
}: {
  salesByStatus: SalesByStatus;
  monthlySales: MonthlySales;
  warehouseUsage: WarehouseUsage;
  stockByCategory: StockByCategory;
  lowStockItems: LowStockItems;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Ventas por estado</CardTitle>
        </CardHeader>
        <CardContent>
          {salesByStatus.every((s) => s.count === 0) ? (
            <EmptyState text="Aún no hay ventas registradas." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={salesByStatus}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e9edf3" vertical={false} />
                <XAxis dataKey="label" tick={axisTick} />
                <YAxis allowDecimals={false} tick={axisTick} />
                <Tooltip formatter={(value: number) => [formatNumber(value), "Ventas"]} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {salesByStatus.map((entry) => (
                    <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#1f2f45"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ventas realizadas (últimos 6 meses)</CardTitle>
        </CardHeader>
        <CardContent>
          {monthlySales.every((m) => m.count === 0) ? (
            <EmptyState text="Aún no hay ventas en este período." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={monthlySales}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e9edf3" vertical={false} />
                <XAxis dataKey="label" tick={axisTick} />
                <YAxis
                  yAxisId="left"
                  tick={axisTick}
                  width={72}
                  tickFormatter={(v: number) => formatCurrency(v)}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  allowDecimals={false}
                  tick={axisTick}
                />
                <Tooltip
                  formatter={(value: number, name: string) =>
                    name === "total"
                      ? [formatCurrency(value), "Ingresos"]
                      : [formatNumber(value), "N° de ventas"]
                  }
                />
                <Legend formatter={(value) => (value === "total" ? "Ingresos" : "N° de ventas")} />
                <Bar yAxisId="left" dataKey="total" fill="#1f2f45" radius={[4, 4, 0, 0]} />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="count"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Uso de bodega (últimos 30 días)</CardTitle>
        </CardHeader>
        <CardContent>
          {warehouseUsage.every((w) => w.entradas === 0 && w.salidas === 0) ? (
            <EmptyState text="Sin movimientos de inventario en los últimos 30 días." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={warehouseUsage}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e9edf3" vertical={false} />
                <XAxis dataKey="name" tick={axisTick} />
                <YAxis allowDecimals={false} tick={axisTick} />
                <Tooltip formatter={(value: number) => formatNumber(value)} />
                <Legend formatter={(value) => (value === "entradas" ? "Entradas" : "Salidas")} />
                <Bar dataKey="entradas" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="salidas" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stock por categoría</CardTitle>
        </CardHeader>
        <CardContent>
          {stockByCategory.length === 0 ? (
            <EmptyState text="Sin stock registrado." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={stockByCategory}
                  dataKey="units"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={(entry) => `${entry.category}: ${formatNumber(entry.units)}`}
                >
                  {stockByCategory.map((entry, i) => (
                    <Cell key={entry.category} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => [formatNumber(value), "Unidades"]} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Productos con stock crítico</CardTitle>
        </CardHeader>
        <CardContent>
          {lowStockItems.length === 0 ? (
            <EmptyState text="Todo el inventario está sobre su umbral mínimo." />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, lowStockItems.length * 40)}>
              <BarChart data={lowStockItems} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e9edf3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={axisTick} />
                <YAxis type="category" dataKey="name" width={160} tick={axisTick} />
                <Tooltip
                  formatter={(value: number, name: string) =>
                    name === "quantity"
                      ? [formatNumber(value), "En stock"]
                      : [formatNumber(value), "Umbral mínimo"]
                  }
                />
                <Legend formatter={(value) => (value === "quantity" ? "En stock" : "Umbral mínimo")} />
                <Bar dataKey="quantity" fill="#ef4444" radius={[0, 4, 4, 0]} />
                <Bar dataKey="threshold" fill="#cfd8e3" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="py-10 text-center text-sm text-slate-500">{text}</p>;
}
