import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { SaleDetail } from "@/components/sale-detail";

export default async function SaleDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "viewSales")) {
    redirect("/dashboard");
  }

  const sale = await prisma.sale.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      createdBy: { select: { name: true } },
      items: { include: { variant: { include: { product: true } } } },
    },
  });

  if (!sale) notFound();

  return (
    <SaleDetail
      sale={JSON.parse(JSON.stringify(sale))}
      canManage={can(session.user.role, "manageSales")}
    />
  );
}
