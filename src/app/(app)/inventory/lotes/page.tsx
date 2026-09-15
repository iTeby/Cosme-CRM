import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { LotsClient } from "@/components/lots-client";

export default async function LotesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "viewCatalog")) {
    redirect("/dashboard");
  }

  const [lotes, variantes, bodega] = await Promise.all([
    prisma.lot.findMany({
      where: { quantity: { gt: 0 } },
      // Los que vencen primero arriba: esto es una lista de pendientes.
      orderBy: [{ expiresAt: "asc" }, { receivedAt: "asc" }],
      take: 300,
      include: {
        variant: { include: { product: { select: { name: true } } } },
        warehouse: { select: { name: true } },
      },
    }),
    prisma.productVariant.findMany({
      where: { active: true, tracksLots: true },
      orderBy: { sku: "asc" },
      include: { product: { select: { name: true } } },
    }),
    prisma.warehouse.findFirst({ where: { isDefault: true } }),
  ]);

  return (
    <LotsClient
      lots={JSON.parse(JSON.stringify(lotes))}
      variants={variantes.map((v) => ({
        id: v.id,
        sku: v.sku,
        nombre: v.product.name,
        unidad: v.unit,
        shelfLifeDays: v.shelfLifeDays,
      }))}
      warehouseName={bodega?.name ?? null}
      canManage={can(session.user.role, "manageStock")}
    />
  );
}
