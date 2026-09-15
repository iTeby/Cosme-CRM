-- Eje de pagos (fiado).
--
-- El estado de la venta y el estado del pago dejan de ser la misma cosa.
-- Antes 'PAGADA' era un SaleStatus, lo que obligaba a elegir entre decir que
-- la mercadería salió o que la plata entró. En un almacén que fía, las dos
-- cosas pasan en momentos distintos y hay que poder decir ambas.
--
-- Esta migración se escribió a mano: Postgres no permite quitar un valor de un
-- enum con ALTER TYPE, y las ventas que ya estaban en 'PAGADA' necesitan un
-- destino explícito en los dos ejes nuevos.

-- AlterTable: el snapshot de lo abonado, igual que stock_levels frente a
-- stock_movements. La suma de payments de una venta debe dar esta columna.
ALTER TABLE "sales" ADD COLUMN "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('EFECTIVO', 'DEBITO', 'CREDITO', 'TRANSFERENCIA');

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'cosme',
    "number" SERIAL NOT NULL,
    "customerId" TEXT NOT NULL,
    "saleId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_number_key" ON "payments"("number");

-- CreateIndex
CREATE INDEX "payments_tenantId_idx" ON "payments"("tenantId");

-- CreateIndex
CREATE INDEX "payments_customerId_idx" ON "payments"("customerId");

-- CreateIndex
CREATE INDEX "payments_saleId_idx" ON "payments"("saleId");

-- CreateIndex
CREATE INDEX "payments_createdAt_idx" ON "payments"("createdAt");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: RESTRICT a propósito. El historial de pagos no se borra junto
-- con la venta; una venta con plata recibida no se puede hacer desaparecer.
ALTER TABLE "payments" ADD CONSTRAINT "payments_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Datos: las ventas que estaban en 'PAGADA' pasan al eje nuevo.
--
-- Se les genera el Payment que las respalda en vez de solo subir paidAmount.
-- Sin esa fila, el snapshot quedaría sin historial detrás y la invariante
-- (paidAmount == suma de payments) nacería rota, que es justo lo que el resto
-- del código da por cierto. El medio de pago real no se sabe, así que va como
-- EFECTIVO y la nota deja el rastro de que salió de esta migración.
INSERT INTO "payments" ("id", "tenantId", "customerId", "saleId", "amount", "method", "notes", "createdById", "createdAt")
SELECT
    gen_random_uuid()::text,
    "s"."tenantId",
    "s"."customerId",
    "s"."id",
    "s"."totalAmount",
    'EFECTIVO',
    'Migrado desde el estado PAGADA. Medio de pago real desconocido.',
    "s"."createdById",
    "s"."createdAt"
FROM "sales" AS s
WHERE "s"."status" = 'PAGADA' AND "s"."totalAmount" <> 0;

UPDATE "sales" SET "paidAmount" = "totalAmount" WHERE "status" = 'PAGADA';

-- Y se mueven al eje de entrega: si el cliente ya pagó, la mercadería salió.
UPDATE "sales" SET "status" = 'ENTREGADA' WHERE "status" = 'PAGADA';

-- AlterEnum: SaleStatus sin 'PAGADA'. Postgres no deja quitar un valor de un
-- enum, así que se crea el tipo nuevo, se castea la columna y se renombra.
CREATE TYPE "SaleStatus_new" AS ENUM ('PENDIENTE', 'ENTREGADA', 'ANULADA');
ALTER TABLE "sales" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "sales" ALTER COLUMN "status" TYPE "SaleStatus_new" USING ("status"::text::"SaleStatus_new");
ALTER TABLE "sales" ALTER COLUMN "status" SET DEFAULT 'PENDIENTE';
DROP TYPE "SaleStatus";
ALTER TYPE "SaleStatus_new" RENAME TO "SaleStatus";
