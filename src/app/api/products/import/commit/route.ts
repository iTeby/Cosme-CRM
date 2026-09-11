import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { setStockAbsolute } from "@/lib/inventory";
import { productImportCommitSchema } from "@/lib/validation";

export const maxDuration = 60;

// Ejecuta la importación ya confirmada por el usuario en /preview. Todo
// corre dentro de una sola transacción (o se aplica completo, o no se
// aplica nada) — con listas prefetch de variantes/bodegas existentes para
// no hacer una consulta por cada fila, ya que un archivo puede traer
// cientos de filas y cada consulta viaja hasta Neon.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageProducts")) {
    return NextResponse.json(
      { error: "No tienes permiso para importar productos" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = productImportCommitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { rows } = parsed.data;

  // Misma combinación sku+bodega repetida dentro del mismo envío: se
  // rechaza todo el lote en vez de adivinar cuál de las dos filas debería
  // ganar. El mismo SKU en DOS bodegas distintas sí es válido (stock
  // repartido), así que la clave incluye la bodega.
  const rowKeysSeen = new Set<string>();
  for (const row of rows) {
    const key = `${row.sku.toLowerCase()}|${row.warehouseName.toLowerCase()}`;
    if (rowKeysSeen.has(key)) {
      return NextResponse.json(
        { error: `SKU duplicado en la misma bodega dentro del envío: ${row.sku} (${row.warehouseName})` },
        { status: 400 }
      );
    }
    rowKeysSeen.add(key);
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        let created = 0;
        let updated = 0;
        let stockAdjustments = 0;
        const warehousesCreated: string[] = [];

        // --- Prefetch: bodegas existentes, variantes existentes por SKU y
        // sus niveles de stock actuales, para no consultar fila por fila.
        const existingWarehouses = await tx.warehouse.findMany();
        const warehouseIdByName = new Map(
          existingWarehouses.map((w) => [w.name.toLowerCase(), w.id])
        );

        // La búsqueda es insensible a mayúsculas y el índice del mapa también.
        // Antes la consulta comparaba exacto pero el mapa se indexaba en
        // minúsculas: un "Pan-01" en el Excel contra un "PAN-01" en la base no
        // se encontraba, entraba por la rama de "no existe" y creaba un SKU
        // duplicado. El stock del mismo producto quedaba partido en dos.
        const skus = rows.map((r) => r.sku);
        const existingVariants = await tx.productVariant.findMany({
          where: { sku: { in: skus, mode: "insensitive" } },
          select: { id: true, sku: true },
        });
        const variantBySku = new Map(existingVariants.map((v) => [v.sku.toLowerCase(), v]));

        for (const row of rows) {
          const warehouseKey = row.warehouseName.toLowerCase();
          let warehouseId = warehouseIdByName.get(warehouseKey);
          if (!warehouseId) {
            const newWarehouse = await tx.warehouse.create({
              data: { name: row.warehouseName, isDefault: false },
            });
            warehouseId = newWarehouse.id;
            warehouseIdByName.set(warehouseKey, warehouseId);
            warehousesCreated.push(row.warehouseName);
          }

          const skuKey = row.sku.toLowerCase();
          let variantId = variantBySku.get(skuKey)?.id;

          if (!variantId) {
            const product = await tx.product.create({ data: { name: row.name } });
            const variant = await tx.productVariant.create({
              data: {
                productId: product.id,
                sku: row.sku,
                price: row.price,
                cost: 0,
                lowStockThreshold: 5,
              },
            });
            variantId = variant.id;
            variantBySku.set(skuKey, variant);
            created += 1;
          } else {
            await tx.productVariant.update({
              where: { id: variantId },
              data: { price: row.price },
            });
            updated += 1;
          }

          // Siempre deja un StockLevel para esa variante+bodega (aunque la
          // diferencia sea 0), pero solo escribe en el historial si hay un
          // cambio real que documentar. Lee el nivel fila por fila a
          // propósito: el prefetch que había antes se calculaba al empezar una
          // transacción que puede durar casi un minuto, y cualquier venta
          // ocurrida en esa ventana quedaba pisada.
          const delta = await setStockAbsolute(tx, {
            variantId,
            warehouseId,
            quantity: row.qty,
            reason: "Importación masiva desde Excel",
            userId: session.user.id,
          });

          if (delta !== 0) stockAdjustments += 1;
        }

        return { created, updated, stockAdjustments, warehousesCreated };
      },
      { timeout: 55000, maxWait: 15000 }
    );

    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo completar la importación" }, { status: 500 });
  }
}
