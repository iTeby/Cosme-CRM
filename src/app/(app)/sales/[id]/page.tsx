import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { currentShift } from "@/lib/cash";
import { dteConfig } from "@/lib/dte";
import { SaleDetail } from "@/components/sale-detail";

export default async function SaleDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "viewSales")) {
    redirect("/dashboard");
  }

  // Bodega entra acá para preparar entregas, pero no ve caja: ni abonos, ni
  // medio de pago, ni saldo. El filtro va en la consulta, no en el render: lo
  // que se incluya acá viaja al navegador aunque no se pinte.
  const canViewPayments = can(session.user.role, "viewPayments");
  const canViewDte = can(session.user.role, "viewDte");

  const sale = await prisma.sale.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      createdBy: { select: { name: true } },
      items: { include: { variant: { include: { product: true } } } },
      ...(canViewPayments
        ? {
            payments: {
              orderBy: { createdAt: "desc" },
              include: { createdBy: { select: { name: true } } },
            },
          }
        : {}),
      ...(canViewDte ? { dtes: { orderBy: { createdAt: "desc" } } } : {}),
      invoices: { orderBy: { issuedAt: "desc" } },
    },
  });

  if (!sale) notFound();

  const data = JSON.parse(JSON.stringify(sale));

  // Para avisar en el formulario antes de cobrar, no para autorizar: quien
  // decide si el efectivo entra es src/lib/cash.ts dentro de la transacción.
  const turnoAbierto = canViewPayments ? await currentShift(prisma, sale.warehouseId) : null;

  // El ambiente se lee en el servidor y viaja como dato, no como decisión del
  // cliente: la etiqueta "certificación" tiene que venir de la configuración
  // real, no de algo que el navegador pueda cambiar.
  const config = canViewDte ? dteConfig() : null;

  return (
    <SaleDetail
      sale={{
        ...data,
        paidAmount: canViewPayments ? data.paidAmount : "0",
        payments: data.payments ?? [],
        invoices: data.invoices ?? [],
      }}
      canManage={can(session.user.role, "manageSales")}
      canViewPayments={canViewPayments}
      canManageInvoices={can(session.user.role, "manageInvoices")}
      canManagePayments={can(session.user.role, "managePayments")}
      cashShiftOpen={turnoAbierto !== null}
      dte={
        config
          ? {
              rows: data.dtes ?? [],
              environment: config.environment,
              provider: config.provider,
              canManage: can(session.user.role, "manageDte"),
            }
          : null
      }
    />
  );
}
