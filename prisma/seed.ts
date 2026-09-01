import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // Bodega por defecto — Fase 01 opera con una sola, pero el modelo ya
  // soporta agregar más (transferencias, multi-bodega) sin migrar nada.
  let warehouse = await prisma.warehouse.findFirst({ where: { isDefault: true } });
  if (!warehouse) {
    warehouse = await prisma.warehouse.create({
      data: { name: "Bodega Central", isDefault: true },
    });
  }

  // Un usuario por rol, para poder probar los permisos de cada uno.
  const users = [
    { email: "admin@cosme.cl", name: "Admin Cosme", role: "ADMIN" as const, password: "Admin123!" },
    { email: "ventas@cosme.cl", name: "Equipo Ventas", role: "VENTAS" as const, password: "Ventas123!" },
    { email: "bodega@cosme.cl", name: "Equipo Bodega", role: "BODEGA" as const, password: "Bodega123!" },
    { email: "compras@cosme.cl", name: "Equipo Compras", role: "COMPRAS" as const, password: "Compras123!" },
  ];

  for (const u of users) {
    const passwordHash = await hash(u.password, 10);
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, name: u.name, role: u.role, passwordHash },
    });
  }

  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@cosme.cl" } });

  // Catálogo de ejemplo. "Botella Térmica 750ml" queda deliberadamente bajo
  // su umbral para que la alerta de stock bajo se vea desde el primer login.
  const catalog = [
    {
      name: "Polera Básica",
      category: "Vestuario",
      description: "Polera de algodón, corte unisex.",
      variants: [
        { sku: "POL-BAS-S", attributes: "Talla S", price: 9990, cost: 4200, threshold: 10, stock: 40 },
        { sku: "POL-BAS-M", attributes: "Talla M", price: 9990, cost: 4200, threshold: 10, stock: 55 },
        { sku: "POL-BAS-L", attributes: "Talla L", price: 9990, cost: 4200, threshold: 10, stock: 8 },
      ],
    },
    {
      name: "Mochila Urbana",
      category: "Accesorios",
      description: "Mochila 20L, resistente al agua.",
      variants: [
        { sku: "MOCH-URB-NEG", attributes: "Negro", price: 24990, cost: 12500, threshold: 5, stock: 18 },
      ],
    },
    {
      name: "Botella Térmica",
      category: "Accesorios",
      description: "Botella de acero inoxidable.",
      variants: [
        { sku: "BOT-TERM-500", attributes: "500ml", price: 12990, cost: 6000, threshold: 8, stock: 22 },
        { sku: "BOT-TERM-750", attributes: "750ml", price: 14990, cost: 7000, threshold: 8, stock: 3 },
      ],
    },
  ];

  for (const item of catalog) {
    let product = await prisma.product.findFirst({ where: { name: item.name } });
    if (!product) {
      product = await prisma.product.create({
        data: { name: item.name, category: item.category, description: item.description },
      });
    }

    for (const v of item.variants) {
      const variant = await prisma.productVariant.upsert({
        where: { sku: v.sku },
        update: {},
        create: {
          productId: product.id,
          sku: v.sku,
          attributes: v.attributes,
          price: v.price,
          cost: v.cost,
          lowStockThreshold: v.threshold,
        },
      });

      const existingLevel = await prisma.stockLevel.findUnique({
        where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } },
      });

      if (!existingLevel) {
        await prisma.stockLevel.create({
          data: { variantId: variant.id, warehouseId: warehouse.id, quantity: v.stock },
        });
        await prisma.stockMovement.create({
          data: {
            variantId: variant.id,
            warehouseId: warehouse.id,
            type: "AJUSTE",
            quantity: v.stock,
            reason: "Carga inicial de stock (seed)",
            userId: admin.id,
          },
        });
      }
    }
  }

  console.log("Seed completo:");
  console.log("  admin@cosme.cl / Admin123!");
  console.log("  ventas@cosme.cl / Ventas123!");
  console.log("  bodega@cosme.cl / Bodega123!");
  console.log("  compras@cosme.cl / Compras123!");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
