-- Caja, turno y código de barras.
--
-- El turno es el período entre que alguien abre el cajón con un fondo y lo
-- cierra contando. La venta y el pago quedan atados al turno en que
-- ocurrieron, que es lo que permite preguntar al cierre si la plata que hay
-- es la que debería haber.

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('ABIERTO', 'CERRADO');

-- CreateTable
CREATE TABLE "cash_shifts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'cosme',
    "number" SERIAL NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'ABIERTO',
    "openKey" TEXT,
    "openingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cashOps" INTEGER NOT NULL DEFAULT 0,
    "expectedAmount" DECIMAL(12,2),
    "countedAmount" DECIMAL(12,2),
    "difference" DECIMAL(12,2),
    "openingNotes" TEXT,
    "closingNotes" TEXT,
    "openedById" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "cash_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_shifts_number_key" ON "cash_shifts"("number");

-- CreateIndex: un solo turno abierto por bodega, garantizado por la base.
-- openKey vale "<tenant>:<bodega>" mientras está abierto y pasa a NULL al
-- cerrar; Postgres no considera iguales dos NULL en un índice único, así que
-- los turnos cerrados conviven y dos aperturas simultáneas de la misma bodega
-- chocan acá en vez de crear dos cajas paralelas.
CREATE UNIQUE INDEX "cash_shifts_openKey_key" ON "cash_shifts"("openKey");

-- CreateIndex
CREATE INDEX "cash_shifts_tenantId_idx" ON "cash_shifts"("tenantId");

-- CreateIndex
CREATE INDEX "cash_shifts_warehouseId_idx" ON "cash_shifts"("warehouseId");

-- CreateIndex
CREATE INDEX "cash_shifts_status_idx" ON "cash_shifts"("status");

-- CreateIndex
CREATE INDEX "cash_shifts_openedAt_idx" ON "cash_shifts"("openedAt");

-- AddForeignKey
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: la venta se ata al turno abierto si lo había. Nulo es válido:
-- una venta fiada no toca el cajón y no se bloquea por no haber turno.
ALTER TABLE "sales" ADD COLUMN "shiftId" TEXT;

-- CreateIndex
CREATE INDEX "sales_shiftId_idx" ON "sales"("shiftId");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "cash_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: el turno en que entró la plata. Obligatorio de hecho para
-- EFECTIVO, que lo exige src/lib/cash.ts, porque un pago en efectivo sin
-- turno no se puede cuadrar contra ningún arqueo.
ALTER TABLE "payments" ADD COLUMN "shiftId" TEXT;

-- CreateIndex
CREATE INDEX "payments_shiftId_idx" ON "payments"("shiftId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "cash_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: el código impreso en el envase, el que lee la pistola. No es el
-- SKU: el SKU lo inventa el almacén y el código de barras viene del
-- fabricante. Nulo para todo lo que se vende a granel.
ALTER TABLE "product_variants" ADD COLUMN "barcode" TEXT;

-- CreateIndex: dos variantes pueden no tener código (NULL no colisiona), pero
-- dos no pueden compartir uno: la pistola tiene que resolver a un producto.
CREATE UNIQUE INDEX "product_variants_tenantId_barcode_key" ON "product_variants"("tenantId", "barcode");
