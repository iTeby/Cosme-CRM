import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { RecipesClient } from "@/components/recipes-client";

export default async function RecipesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "viewProduction")) redirect("/dashboard");

  const variants = await prisma.productVariant.findMany({
    where: { active: true },
    orderBy: [{ product: { name: "asc" } }, { sku: "asc" }],
    include: {
      product: { select: { name: true } },
      recipe: {
        include: {
          items: {
            include: { variant: { include: { product: { select: { name: true } } } } },
          },
        },
      },
    },
  });

  // Insumos que una receta usa pero que ya no están activos en el catálogo: un
  // formato de saco descontinuado, por ejemplo. Sin traerlos, el desplegable
  // del editor recibiría un valor sin opción correspondiente, se vería en
  // blanco, y al guardar ese insumo desaparecería de la receta sin que nadie
  // lo note. Las producciones siguientes dejarían de descontarlo.
  const idsDeInsumos = [
    ...new Set(variants.flatMap((v) => v.recipe?.items.map((i) => i.variantId) ?? [])),
  ];
  const insumosInactivos = idsDeInsumos.length
    ? await prisma.productVariant.findMany({
        where: { id: { in: idsDeInsumos }, active: false },
        include: { product: { select: { name: true } } },
      })
    : [];

  return (
    <RecipesClient
      variants={JSON.parse(JSON.stringify(variants))}
      insumosInactivos={JSON.parse(JSON.stringify(insumosInactivos))}
      canManage={can(session.user.role, "manageRecipes")}
    />
  );
}
