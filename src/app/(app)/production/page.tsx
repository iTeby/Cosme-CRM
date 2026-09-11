import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { ProductionClient } from "@/components/production-client";

export default async function ProductionPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "viewProduction")) redirect("/dashboard");

  const [warehouse, variants, productions] = await Promise.all([
    // El servidor descuenta de la bodega por defecto. La pantalla tiene que
    // mirar el stock de ESA bodega, no el total de todas, o mostraría
    // disponible algo que la producción va a rechazar.
    prisma.warehouse.findFirst({ where: { isDefault: true }, select: { id: true, name: true } }),
    prisma.productVariant.findMany({
      where: { active: true },
      orderBy: { sku: "asc" },
      include: {
        product: { select: { name: true } },
        stockLevels: { select: { quantity: true, warehouseId: true } },
        recipe: {
          include: {
            items: {
              include: {
                // stockLevels del insumo acá y no solo en la lista de variantes
                // activas: una receta puede referenciar un insumo desactivado
                // —un saco descontinuado— y sin esto la pantalla lo mostraría
                // con stock 0 y avisaría de una falta que no existe.
                variant: {
                  include: {
                    product: { select: { name: true } },
                    stockLevels: { select: { quantity: true, warehouseId: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.productionOrder.findMany({
      orderBy: { producedOn: "desc" },
      take: 20,
      include: {
        warehouse: { select: { name: true } },
        createdBy: { select: { name: true } },
        items: {
          include: { variant: { include: { product: { select: { name: true } } } } },
        },
      },
    }),
  ]);

  return (
    <ProductionClient
      variants={JSON.parse(JSON.stringify(variants))}
      productions={JSON.parse(JSON.stringify(productions))}
      warehouse={warehouse ? { id: warehouse.id, name: warehouse.name } : null}
      canManage={can(session.user.role, "manageProduction")}
    />
  );
}
