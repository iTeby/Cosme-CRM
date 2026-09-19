import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { ProductDetail } from "@/components/product-detail";

export default async function ProductDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "viewCatalog")) {
    redirect("/dashboard");
  }

  const product = await prisma.product.findUnique({
    where: { id: params.id },
    include: {
      variants: {
        include: { stockLevels: { include: { warehouse: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!product) notFound();

  return (
    <ProductDetail
      product={JSON.parse(JSON.stringify(product))}
      canManage={can(session.user.role, "manageProducts")}
      canViewCost={can(session.user.role, "viewCost")}
    />
  );
}
