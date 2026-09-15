import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { SubscriptionDetail } from "@/components/subscription-detail";

export default async function SubscriptionDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "viewSubscriptions")) {
    redirect("/dashboard");
  }

  const subscription = await prisma.subscription.findUnique({
    where: { id: params.id },
    include: {
      customer: { select: { id: true, name: true, contactName: true } },
      sale: { select: { id: true, number: true, totalAmount: true, paidAmount: true, status: true } },
      hourLogs: {
        orderBy: { loggedAt: "desc" },
        include: { createdBy: { select: { name: true } } },
      },
    },
  });
  if (!subscription) notFound();

  return (
    <SubscriptionDetail
      subscription={JSON.parse(JSON.stringify(subscription))}
      canManage={can(session.user.role, "manageSubscriptions")}
      canRenew={can(session.user.role, "manageSubscriptions") && can(session.user.role, "manageSales")}
    />
  );
}
