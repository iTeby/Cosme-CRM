import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { SupplierDetail } from "@/components/supplier-detail";

export default async function SupplierDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "manageSuppliers")) {
    redirect("/dashboard");
  }

  const supplier = await prisma.supplier.findUnique({
    where: { id: params.id },
    include: {
      purchases: {
        orderBy: { createdAt: "desc" },
        include: { items: true },
      },
    },
  });

  if (!supplier) notFound();

  return <SupplierDetail supplier={JSON.parse(JSON.stringify(supplier))} canManage />;
}
