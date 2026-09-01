import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { ProductDetail } from "@/components/product-detail";

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return null;

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
    />
  );
}
