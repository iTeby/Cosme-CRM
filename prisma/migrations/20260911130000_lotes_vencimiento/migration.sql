-- Lotes y vencimiento.
--
-- Un lote es una tanda que entró junta y vence junta. Existe por una sola
-- razón operativa: poder despachar siempre lo que vence primero, y saber qué
-- hay que rebajar o botar antes de que se pierda.
--
-- No todo producto lleva lote: la mayoría del almacén no vence en un plazo
-- que importe, y obligar a elegir lote para vender arroz haría la caja
-- impracticable. Por eso tracksLots nace en false para todo lo existente.

-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('DISPONIBLE', 'BLOQUEADO', 'VENCIDO');

-- AlterTable: qué productos llevan lote y con qué plazos.
--
-- Los plazos son NULL a propósito: no hay un número correcto para todo el
-- almacén y ponerle uno por defecto sería inventarlo. El pan vence en un
-- día y un tarro de conservas en dos años.
ALTER TABLE "product_variants" ADD COLUMN "tracksLots" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "product_variants" ADD COLUMN "shelfLifeDays" INTEGER;
ALTER TABLE "product_variants" ADD COLUMN "nearExpiryDays" INTEGER;

-- CreateTable
CREATE TABLE "lots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'cosme',
    "variantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "status" "LotStatus" NOT NULL DEFAULT 'DISPONIBLE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: el mismo numero de lote del mismo producto en la misma bodega
-- es el mismo lote. Recibir dos veces suma, no duplica.
CREATE UNIQUE INDEX "lots_tenantId_variantId_warehouseId_code_key" ON "lots"("tenantId", "variantId", "warehouseId", "code");

-- CreateIndex: el indice que hace barato el FEFO. Por producto y bodega,
-- ordenado por vencimiento, que es exactamente la consulta de cada venta.
CREATE INDEX "lots_variantId_warehouseId_expiresAt_idx" ON "lots"("variantId", "warehouseId", "expiresAt");

-- CreateIndex
CREATE INDEX "lots_tenantId_idx" ON "lots"("tenantId");

-- CreateIndex
CREATE INDEX "lots_expiresAt_idx" ON "lots"("expiresAt");

-- CreateIndex
CREATE INDEX "lots_status_idx" ON "lots"("status");

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: el movimiento dice a que lote pertenece. Nulo para todo lo que
-- no lleva lote, que es la mayoria del almacen.
ALTER TABLE "stock_movements" ADD COLUMN "lotId" TEXT;

-- CreateIndex
CREATE INDEX "stock_movements_lotId_idx" ON "stock_movements"("lotId");

-- AddForeignKey: Restrict. Un lote con historial no se borra, igual que una
-- venta o una produccion con movimientos detras.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
