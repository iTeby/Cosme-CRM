import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { recipeUpsertSchema, primerMensaje } from "@/lib/validation";

// La receta de un producto terminado. Es 1 a 1 con la variante: un producto
// tiene a lo más una receta vigente, y cambiarla es editarla. Guardar reemplaza
// los insumos completos en vez de hacer diferencias — son listas de tres o
// cuatro líneas y el reemplazo evita estados intermedios raros.

export async function GET(_req: NextRequest, props: { params: Promise<{ variantId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "viewProduction")) {
    return NextResponse.json({ error: "No tienes permiso para ver recetas" }, { status: 403 });
  }

  const recipe = await prisma.recipe.findUnique({
    where: { variantId: params.variantId },
    include: { items: { include: { variant: { include: { product: true } } } } },
  });

  if (!recipe) return NextResponse.json(null);
  return NextResponse.json(recipe);
}

export async function PUT(req: NextRequest, props: { params: Promise<{ variantId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageRecipes")) {
    return NextResponse.json({ error: "No tienes permiso para editar recetas" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = recipeUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: primerMensaje(parsed.error) }, { status: 400 });
  }
  const { yield: yieldQty, notes, active, items } = parsed.data;

  if (items.some((i) => i.variantId === params.variantId)) {
    return NextResponse.json(
      { error: "Un producto no puede ser insumo de su propia receta" },
      { status: 400 }
    );
  }

  try {
    const recipe = await prisma.$transaction(async (tx) => {
      const target = await tx.productVariant.findUnique({ where: { id: params.variantId } });
      if (!target) throw new Error("VARIANT_NOT_FOUND");

      const inputs = await tx.productVariant.findMany({
        where: { id: { in: items.map((i) => i.variantId) } },
        select: { id: true },
      });
      if (inputs.length !== items.length) throw new Error("INPUT_NOT_FOUND");

      const saved = await tx.recipe.upsert({
        where: { variantId: params.variantId },
        create: { variantId: params.variantId, yield: yieldQty, notes: notes || null, active },
        update: { yield: yieldQty, notes: notes || null, active },
      });

      await tx.recipeItem.deleteMany({ where: { recipeId: saved.id } });
      for (const item of items) {
        await tx.recipeItem.create({
          data: { recipeId: saved.id, variantId: item.variantId, quantity: item.quantity },
        });
      }

      return tx.recipe.findUniqueOrThrow({
        where: { id: saved.id },
        include: { items: { include: { variant: { include: { product: true } } } } },
      });
    });

    return NextResponse.json(recipe);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message === "VARIANT_NOT_FOUND") {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }
    if (message === "INPUT_NOT_FOUND") {
      return NextResponse.json({ error: "Alguno de los insumos no existe" }, { status: 404 });
    }
    if ((err as { code?: string })?.code === "P2002") {
      return NextResponse.json(
        { error: "Otra persona guardó esta receta al mismo tiempo. Recarga y vuelve a intentar." },
        { status: 409 }
      );
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo guardar la receta" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ variantId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageRecipes")) {
    return NextResponse.json({ error: "No tienes permiso para eliminar recetas" }, { status: 403 });
  }

  // Borrar la receta no toca ninguna producción ya registrada: esas dejaron
  // sus movimientos de CONSUMO en el historial, que es inmutable. Solo cambia
  // lo que descontarán las producciones futuras.
  // deleteMany y no findUnique + delete: entre las dos consultas la receta
  // puede desaparecer y el delete lanzaría un P2025 sin manejar.
  const deleted = await prisma.recipe.deleteMany({ where: { variantId: params.variantId } });
  if (deleted.count === 0) {
    return NextResponse.json({ error: "Receta no encontrada" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
