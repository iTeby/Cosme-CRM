import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { InventoryClient } from "@/components/inventory-client";

export default async function InventoryPage() {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  const [variants, warehouses, movements] = await Promise.all([
    prisma.productVariant.findMany({
      where: { active: true },
      include: { product: true, stockLevels: true },
      orderBy: { sku: "asc" },
    }),
    prisma.warehouse.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }] }),
    prisma.stockMovement.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        variant: { include: { product: true } },
        warehouse: true,
        user: { select: { name: true } },
      },
    }),
  ]);

  return (
    <InventoryClient
      variants={JSON.parse(JSON.stringify(variants))}
      warehouses={JSON.parse(JSON.stringify(warehouses))}
      movements={JSON.parse(JSON.stringify(movements))}
      canManage={can(session.user.role, "manageStock")}
      canEditMovements={can(session.user.role, "editStockMovements")}
    />
  );
}
