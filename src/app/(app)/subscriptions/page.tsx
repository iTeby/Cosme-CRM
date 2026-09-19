import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { SubscriptionList } from "@/components/subscription-list";

export default async function SubscriptionsPage(
  props: {
    searchParams: Promise<{ customerId?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "viewSubscriptions")) {
    redirect("/dashboard");
  }

  const canManage = can(session.user.role, "manageSubscriptions");

  const [subscriptions, customers] = await Promise.all([
    prisma.subscription.findMany({
      orderBy: { renewsAt: "asc" },
      include: { customer: { select: { id: true, name: true } } },
    }),
    canManage
      ? prisma.customer.findMany({
          where: { active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <SubscriptionList
      subscriptions={JSON.parse(JSON.stringify(subscriptions))}
      customers={customers}
      canManage={canManage}
      defaultCustomerId={searchParams.customerId}
    />
  );
}
