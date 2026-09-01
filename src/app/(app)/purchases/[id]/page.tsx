import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { PurchaseDetail } from "@/components/purchase-detail";

export default async function PurchaseDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "viewPurchases")) {
    redirect("/dashboard");
  }

  const purchase = await prisma.purchase.findUnique({
    where: { id: params.id },
    include: {
      supplier: true,
      createdBy: { select: { name: true } },
      items: { include: { variant: { include: { product: true } } } },
    },
  });

  if (!purchase) notFound();

  return (
    <PurchaseDetail
      purchase={JSON.parse(JSON.stringify(purchase))}
      canManage={can(session.user.role, "managePurchases")}
    />
  );
}
