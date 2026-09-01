import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { CustomerManagement } from "@/components/customer-management";

export default async function CustomersPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "manageCustomers")) {
    redirect("/dashboard");
  }

  const customers = await prisma.customer.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { sales: true } } },
  });

  return <CustomerManagement customers={JSON.parse(JSON.stringify(customers))} />;
}
