-- Tipo de precio y enlace público por producto. Aditiva: columnas con
-- valor por defecto o nulas, sin tocar filas existentes.
CREATE TYPE "PricingType" AS ENUM ('FIJO', 'COTIZADO', 'SUSCRIPCION');
ALTER TABLE "products" ADD COLUMN "pricingType" "PricingType" NOT NULL DEFAULT 'FIJO';
ALTER TABLE "products" ADD COLUMN "url" TEXT;
