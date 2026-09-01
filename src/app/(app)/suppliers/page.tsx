import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { SupplierManagement } from "@/components/supplier-management";

export default async function SuppliersPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "manageSuppliers")) {
    redirect("/dashboard");
  }

  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { purchases: true } } },
  });

  return <SupplierManagement suppliers={JSON.parse(JSON.stringify(suppliers))} />;
}
