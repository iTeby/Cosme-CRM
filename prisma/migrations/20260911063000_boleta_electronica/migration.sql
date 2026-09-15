-- Boleta electrónica.
--
-- El ambiente se guarda por documento y no se deduce de la configuración: una
-- boleta de certificación tiene que seguir siendo reconocible como tal dentro
-- de un año, aunque para entonces el sistema esté emitiendo de verdad.

-- CreateEnum
CREATE TYPE "DteType" AS ENUM ('BOLETA', 'BOLETA_EXENTA', 'FACTURA');

-- CreateEnum
CREATE TYPE "DteEnvironment" AS ENUM ('CERTIFICACION', 'PRODUCCION');

-- CreateEnum
-- INDETERMINADO no es un ERROR: es "no se sabe si el folio se consumió".
-- Un ERROR se reintenta al instante; un INDETERMINADO no, porque reintentar
-- sobre un folio ya consumido emite el segundo.
CREATE TYPE "DteStatus" AS ENUM ('PENDIENTE', 'ENVIADO', 'ACEPTADO', 'RECHAZADO', 'ERROR', 'INDETERMINADO', 'ANULADO');

-- CreateTable
CREATE TABLE "dtes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'cosme',
    "saleId" TEXT NOT NULL,
    "type" "DteType" NOT NULL,
    "environment" "DteEnvironment" NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "DteStatus" NOT NULL DEFAULT 'PENDIENTE',
    "folio" INTEGER,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "roundingDelta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "externalId" TEXT,
    "trackId" TEXT,
    "pdfUrl" TEXT,
    "rawResponse" TEXT,
    "errorMessage" TEXT,
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dtes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: un documento por venta, tipo y ambiente. Es lo que impide que
-- dos clics emitan dos boletas de la misma venta.
CREATE UNIQUE INDEX "dtes_idempotencyKey_key" ON "dtes"("idempotencyKey");

-- CreateIndex: un folio no se repite dentro de un tipo y un ambiente. Los
-- nulos no colisionan, así que los documentos aún sin folio conviven.
CREATE UNIQUE INDEX "dtes_tenantId_environment_type_folio_key" ON "dtes"("tenantId", "environment", "type", "folio");

-- CreateIndex
CREATE INDEX "dtes_tenantId_idx" ON "dtes"("tenantId");

-- CreateIndex
CREATE INDEX "dtes_saleId_idx" ON "dtes"("saleId");

-- CreateIndex
CREATE INDEX "dtes_status_idx" ON "dtes"("status");

-- AddForeignKey: Restrict. Una venta con boleta emitida no se borra; se anula
-- con nota de crédito, que es un documento nuevo, no la desaparición de uno.
ALTER TABLE "dtes" ADD CONSTRAINT "dtes_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
