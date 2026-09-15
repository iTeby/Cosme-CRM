/*
  Warnings:

  - You are about to alter the column `lowStockThreshold` on the `product_variants` table. The data in that column could be lost. The data in that column will be cast from `Integer` to `Decimal(12,3)`.
  - You are about to alter the column `quantity` on the `purchase_items` table. The data in that column could be lost. The data in that column will be cast from `Integer` to `Decimal(12,3)`.
  - You are about to alter the column `quantity` on the `sale_items` table. The data in that column could be lost. The data in that column will be cast from `Integer` to `Decimal(12,3)`.
  - You are about to alter the column `quantity` on the `stock_levels` table. The data in that column could be lost. The data in that column will be cast from `Integer` to `Decimal(12,3)`.
  - You are about to alter the column `quantity` on the `stock_movements` table. The data in that column could be lost. The data in that column will be cast from `Integer` to `Decimal(12,3)`.
  - A unique constraint covering the columns `[tenantId,sku]` on the table `product_variants` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MovementType" ADD VALUE 'MERMA';
ALTER TYPE "MovementType" ADD VALUE 'CONSUMO';
ALTER TYPE "MovementType" ADD VALUE 'PRODUCCION';

-- DropForeignKey
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_purchaseId_fkey";

-- DropForeignKey
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_saleId_fkey";

-- DropIndex
DROP INDEX "product_variants_sku_key";

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'cosme';

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'cosme',
ADD COLUMN     "unit" TEXT NOT NULL DEFAULT 'UN',
ALTER COLUMN "lowStockThreshold" SET DEFAULT 5,
ALTER COLUMN "lowStockThreshold" SET DATA TYPE DECIMAL(12,3);

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'cosme';

-- AlterTable
ALTER TABLE "purchase_items" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,3);

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'cosme';

-- AlterTable
ALTER TABLE "sale_items" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,3);

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'cosme';

-- AlterTable
ALTER TABLE "stock_levels" ALTER COLUMN "quantity" SET DEFAULT 0,
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,3);

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "productionId" TEXT,
ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'cosme',
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,3);

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'cosme';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'cosme';

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'cosme';

-- CreateTable
CREATE TABLE "recipes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'cosme',
    "variantId" TEXT NOT NULL,
    "yield" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_items" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "recipe_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'cosme',
    "number" SERIAL NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "producedOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_items" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantityProduced" DECIMAL(12,3) NOT NULL,
    "quantityWasted" DECIMAL(12,3) NOT NULL DEFAULT 0,

    CONSTRAINT "production_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recipes_variantId_key" ON "recipes"("variantId");

-- CreateIndex
CREATE INDEX "recipes_tenantId_idx" ON "recipes"("tenantId");

-- CreateIndex
CREATE INDEX "recipe_items_recipeId_idx" ON "recipe_items"("recipeId");

-- CreateIndex
CREATE INDEX "recipe_items_variantId_idx" ON "recipe_items"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_items_recipeId_variantId_key" ON "recipe_items"("recipeId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_number_key" ON "production_orders"("number");

-- CreateIndex
CREATE INDEX "production_orders_tenantId_idx" ON "production_orders"("tenantId");

-- CreateIndex
CREATE INDEX "production_orders_warehouseId_idx" ON "production_orders"("warehouseId");

-- CreateIndex
CREATE INDEX "production_orders_producedOn_idx" ON "production_orders"("producedOn");

-- CreateIndex
CREATE INDEX "production_items_productionId_idx" ON "production_items"("productionId");

-- CreateIndex
CREATE INDEX "production_items_variantId_idx" ON "production_items"("variantId");

-- CreateIndex
CREATE INDEX "customers_tenantId_idx" ON "customers"("tenantId");

-- CreateIndex
CREATE INDEX "product_variants_tenantId_idx" ON "product_variants"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_tenantId_sku_key" ON "product_variants"("tenantId", "sku");

-- CreateIndex
CREATE INDEX "products_tenantId_idx" ON "products"("tenantId");

-- CreateIndex
CREATE INDEX "purchases_tenantId_idx" ON "purchases"("tenantId");

-- CreateIndex
CREATE INDEX "sales_tenantId_idx" ON "sales"("tenantId");

-- CreateIndex
CREATE INDEX "stock_movements_productionId_idx" ON "stock_movements"("productionId");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_idx" ON "stock_movements"("tenantId");

-- CreateIndex
CREATE INDEX "suppliers_tenantId_idx" ON "suppliers"("tenantId");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE INDEX "warehouses_tenantId_idx" ON "warehouses"("tenantId");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
