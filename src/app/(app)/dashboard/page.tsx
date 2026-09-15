import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { sumQuantities, toNumber } from "@/lib/decimal";
import { outstanding } from "@/lib/sales";
import { CUSTOMER_STAGES, customerStageLabels, customerStageTone } from "@/lib/customers";
import { formatQuoteAmount } from "@/lib/quotes";
import { RENEWAL_WARNING_DAYS, daysUntil } from "@/lib/subscriptions";

const QUOTE_WARNING_DAYS = 7;

// El panel mira el embudo comercial: quién está en qué etapa, qué cotizaciones
// están por vencer, cuánto hay por cobrar y qué suscripciones se renuevan
// pronto. El inventario queda como una línea al pie mientras no haya
// productos físicos.
export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  const role = session.user.role;
  const canViewSales = can(role, "viewSales");
  const canViewPayments = can(role, "viewPayments");
  const canViewQuotes = can(role, "viewQuotes");
  const canViewSubscriptions = can(role, "viewSubscriptions");
  const canViewCustomers = can(role, "manageCustomers");

  const hoy = new Date();
  const limiteCotizaciones = new Date(hoy.getTime() + QUOTE_WARNING_DAYS * 86_400_000);
  const limiteRenovaciones = new Date(hoy.getTime() + RENEWAL_WARNING_DAYS * 86_400_000);

  const [
    stageCounts,
    proximosContactos,
    cotizacionesAbiertas,
    pendingSales,
    receivables,
    ventasPorCobrar,
    renovaciones,
    variants,
  ] = await Promise.all([
    canViewCustomers
      ? prisma.customer.groupBy({ by: ["stage"], where: { active: true }, _count: { _all: true } })
      : Promise.resolve([]),
    canViewCustomers
      ? prisma.customer.findMany({
          where: { active: true, nextContactAt: { not: null }, stage: { notIn: ["CLIENTE", "PERDIDO"] } },
          orderBy: { nextContactAt: "asc" },
          take: 8,
          select: { id: true, name: true, contactName: true, stage: true, nextContactAt: true },
        })
      : Promise.resolve([]),
    canViewQuotes
      ? prisma.quote.findMany({
          where: { status: { in: ["BORRADOR", "ENVIADA"] } },
          orderBy: { validUntil: "asc" },
          select: {
            id: true,
            number: true,
            status: true,
            currency: true,
            totalAmount: true,
            validUntil: true,
            customer: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    canViewSales ? prisma.sale.count({ where: { status: "PENDIENTE" } }) : Promise.resolve(0),
    canViewPayments
      ? prisma.sale.aggregate({
          where: { status: { not: "ANULADA" } },
          _sum: { totalAmount: true, paidAmount: true },
        })
      : Promise.resolve(null),
    canViewPayments
      ? prisma.sale.findMany({
          where: { status: { not: "ANULADA" } },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            number: true,
            totalAmount: true,
            paidAmount: true,
            purchaseOrder: true,
            createdAt: true,
            customer: { select: { name: true } },
            invoices: { where: { status: "EMITIDA" }, select: { number: true } },
          },
        })
      : Promise.resolve([]),
    canViewSubscriptions
      ? prisma.subscription.findMany({
          where: { status: "ACTIVA", renewsAt: { lte: limiteRenovaciones } },
          orderBy: { renewsAt: "asc" },
          take: 8,
          select: {
            id: true,
            name: true,
            currency: true,
            amount: true,
            renewsAt: true,
            customer: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    prisma.productVariant.findMany({
      where: { active: true, tracksStock: true },
      select: { lowStockThreshold: true, stockLevels: { select: { quantity: true } } },
    }),
  ]);

  const conteoPorEtapa = Object.fromEntries(
    CUSTOMER_STAGES.map((s) => [s, stageCounts.find((c) => c.stage === s)?._count._all ?? 0])
  ) as Record<(typeof CUSTOMER_STAGES)[number], number>;
  const enEmbudo = conteoPorEtapa.NUEVO + conteoPorEtapa.CALIFICADO + conteoPorEtapa.COTIZADO;

  const porVencer = cotizacionesAbiertas.filter(
    (q) => q.status === "ENVIADA" && q.validUntil <= limiteCotizaciones
  );
  const porCobrar = receivables
    ? outstanding(receivables._sum.totalAmount ?? 0, receivables._sum.paidAmount ?? 0)
    : 0;
  const ventasConSaldo = ventasPorCobrar
    .map((v) => ({ ...v, saldo: outstanding(v.totalAmount, v.paidAmount) }))
    .filter((v) => v.saldo > 0);

  const lowStock = variants.filter((v) => {
    const total = sumQuantities(v.stockLevels.map((l) => l.quantity));
    const threshold = toNumber(v.lowStockThreshold);
    return threshold > 0 && total <= threshold;
  }).length;

  const stats = [
    ...(canViewCustomers ? [{ label: "Interesados en el embudo", value: formatNumber(enEmbudo) }] : []),
    ...(canViewQuotes
      ? [
          { label: "Cotizaciones abiertas", value: formatNumber(cotizacionesAbiertas.length) },
          { label: "Por vencer (7 días)", value: formatNumber(porVencer.length), warn: porVencer.length > 0 },
        ]
      : []),
    ...(canViewSales ? [{ label: "Ventas en curso", value: formatNumber(pendingSales) }] : []),
    ...(canViewPayments
      ? [{ label: "Por cobrar", value: formatCurrency(porCobrar), warn: porCobrar > 0 }]
      : []),
    ...(canViewSubscriptions
      ? [{ label: "Renovaciones (60 días)", value: formatNumber(renovaciones.length), warn: renovaciones.length > 0 }]
      : []),
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-brand-900">
          Hola, {session.user.name?.split(" ")[0] ?? ""}
        </h1>
        <p className="text-sm text-slate-500">Lo que hay que mover hoy.</p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="py-5">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{stat.label}</p>
              <p className={`mt-1 text-2xl font-semibold ${stat.warn ? "text-amber-700" : "text-brand-900"}`}>
                {stat.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {canViewCustomers && (
          <Card>
            <CardHeader>
              <CardTitle>Interesados por etapa</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap gap-2">
                {CUSTOMER_STAGES.map((s) => (
                  <Badge key={s} tone={customerStageTone[s]}>
                    {customerStageLabels[s]}: {conteoPorEtapa[s]}
                  </Badge>
                ))}
              </div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Próximos contactos</p>
              {proximosContactos.length === 0 ? (
                <p className="text-sm text-slate-500">Nadie tiene fecha de próximo contacto.</p>
              ) : (
                <ul className="space-y-2">
                  {proximosContactos.map((c) => {
                    const atrasado = c.nextContactAt !== null && c.nextContactAt < hoy;
                    return (
                      <li key={c.id} className="flex items-center justify-between text-sm">
                        <Link href={`/customers/${c.id}`} className="text-slate-700 hover:text-brand-700 hover:underline">
                          {c.name}
                          {c.contactName && <span className="text-xs text-slate-400"> · {c.contactName}</span>}
                        </Link>
                        <span className={atrasado ? "text-xs font-medium text-red-700" : "text-xs text-slate-500"}>
                          {c.nextContactAt ? formatDate(c.nextContactAt) : "—"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {canViewQuotes && (
          <Card>
            <CardHeader>
              <CardTitle>Cotizaciones abiertas</CardTitle>
            </CardHeader>
            <CardContent>
              {cotizacionesAbiertas.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No hay cotizaciones abiertas.{" "}
                  <Link href="/quotes/new" className="font-medium text-brand-700 hover:underline">
                    Crear una
                  </Link>
                  .
                </p>
              ) : (
                <ul className="space-y-2">
                  {cotizacionesAbiertas.slice(0, 8).map((q) => {
                    const dias = daysUntil(q.validUntil, hoy);
                    const vencida = q.status === "ENVIADA" && dias < 0;
                    return (
                      <li key={q.id} className="flex items-center justify-between text-sm">
                        <Link href={`/quotes/${q.id}`} className="text-slate-700 hover:text-brand-700 hover:underline">
                          #{q.number} · {q.customer.name}
                        </Link>
                        <span className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">{formatQuoteAmount(q.totalAmount, q.currency)}</span>
                          {q.status === "BORRADOR" ? (
                            <Badge tone="neutral">Borrador</Badge>
                          ) : vencida ? (
                            <Badge tone="critical">Vencida</Badge>
                          ) : dias <= QUOTE_WARNING_DAYS ? (
                            <Badge tone="warn">Vence en {dias} d</Badge>
                          ) : (
                            <Badge tone="good">Enviada</Badge>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {canViewPayments && (
          <Card>
            <CardHeader>
              <CardTitle>Por cobrar</CardTitle>
            </CardHeader>
            <CardContent>
              {ventasConSaldo.length === 0 ? (
                <p className="text-sm text-slate-500">No hay ventas con saldo pendiente.</p>
              ) : (
                <ul className="space-y-2">
                  {ventasConSaldo.slice(0, 8).map((v) => (
                    <li key={v.id} className="flex items-center justify-between text-sm">
                      <Link href={`/sales/${v.id}`} className="text-slate-700 hover:text-brand-700 hover:underline">
                        #{v.number} · {v.customer.name}
                        <span className="block text-xs text-slate-400">
                          {formatDate(v.createdAt)}
                          {v.purchaseOrder ? ` · OC ${v.purchaseOrder}` : ""}
                          {v.invoices.length > 0
                            ? ` · Factura ${v.invoices.map((i) => i.number).join(", ")}`
                            : " · Sin factura"}
                        </span>
                      </Link>
                      <span className="font-medium text-red-700">{formatCurrency(v.saldo)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {canViewSubscriptions && (
          <Card>
            <CardHeader>
              <CardTitle>Renovaciones próximas</CardTitle>
            </CardHeader>
            <CardContent>
              {renovaciones.length === 0 ? (
                <p className="text-sm text-slate-500">Ninguna suscripción se renueva en los próximos 60 días.</p>
              ) : (
                <ul className="space-y-2">
                  {renovaciones.map((s) => {
                    const dias = daysUntil(s.renewsAt, hoy);
                    return (
                      <li key={s.id} className="flex items-center justify-between text-sm">
                        <Link href={`/subscriptions/${s.id}`} className="text-slate-700 hover:text-brand-700 hover:underline">
                          {s.name} · {s.customer.name}
                          <span className="block text-xs text-slate-400">{formatQuoteAmount(s.amount, s.currency)}</span>
                        </Link>
                        <Badge tone={dias < 0 ? "critical" : "warn"}>
                          {dias < 0 ? `Venció hace ${-dias} d` : `En ${dias} d`}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {lowStock > 0 && (
        <p className="mt-6 text-sm text-amber-700">
          {lowStock === 1 ? "Hay 1 producto físico" : `Hay ${lowStock} productos físicos`} bajo su umbral de stock.{" "}
          <Link href="/products" className="font-medium hover:underline">
            Ver productos
          </Link>
          .
        </p>
      )}
    </div>
  );
}
