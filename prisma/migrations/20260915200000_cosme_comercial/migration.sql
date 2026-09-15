-- Cosme SpA como usuario del CRM: interesados con etapa, guion de
-- calificación, cotizaciones, facturas, suscripciones. Aditiva: solo crea
-- tipos, tablas y columnas con valor por defecto o nulas.

CREATE TYPE "CustomerStage" AS ENUM ('NUEVO', 'CALIFICADO', 'COTIZADO', 'CLIENTE', 'PERDIDO');
CREATE TYPE "LeadSource" AS ENUM ('WHATSAPP', 'WEB', 'DEMO', 'REFERIDO', 'OTRO');
CREATE TYPE "QuoteStatus" AS ENUM ('BORRADOR', 'ENVIADA', 'ACEPTADA', 'RECHAZADA');
CREATE TYPE "Currency" AS ENUM ('CLP', 'UF');
CREATE TYPE "InvoiceStatus" AS ENUM ('EMITIDA', 'ANULADA');
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVA', 'CANCELADA');

ALTER TABLE "customers"
  ADD COLUMN "contactName" TEXT,
  ADD COLUMN "stage" "CustomerStage" NOT NULL DEFAULT 'NUEVO',
  ADD COLUMN "source" "LeadSource",
  ADD COLUMN "nextContactAt" TIMESTAMP(3),
  ADD COLUMN "diagnosticCreditUsedAt" TIMESTAMP(3);

ALTER TABLE "product_variants" ADD COLUMN "tracksStock" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "sales"
  ADD COLUMN "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "purchaseOrder" TEXT;

CREATE TABLE "qualification_questions" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL DEFAULT 'cosme',
  "position" INTEGER NOT NULL,
  "block" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "qualification_questions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "qualification_questions_tenantId_idx" ON "qualification_questions"("tenantId");

CREATE TABLE "qualification_answers" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "qualification_answers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "qualification_answers_customerId_questionId_key" ON "qualification_answers"("customerId", "questionId");
ALTER TABLE "qualification_answers" ADD CONSTRAINT "qualification_answers_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "qualification_answers" ADD CONSTRAINT "qualification_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "qualification_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "quotes" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL DEFAULT 'cosme',
  "number" SERIAL NOT NULL,
  "customerId" TEXT NOT NULL,
  "status" "QuoteStatus" NOT NULL DEFAULT 'BORRADOR',
  "currency" "Currency" NOT NULL DEFAULT 'CLP',
  "ufValue" DECIMAL(12,2),
  "validUntil" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "sentAt" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "saleId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "quotes_number_key" ON "quotes"("number");
CREATE UNIQUE INDEX "quotes_saleId_key" ON "quotes"("saleId");
CREATE INDEX "quotes_customerId_idx" ON "quotes"("customerId");
CREATE INDEX "quotes_status_idx" ON "quotes"("status");
CREATE INDEX "quotes_tenantId_idx" ON "quotes"("tenantId");
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "quote_items" (
  "id" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(12,3) NOT NULL,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "subtotal" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "quote_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "quote_items_quoteId_idx" ON "quote_items"("quoteId");
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "invoices" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL DEFAULT 'cosme',
  "number" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "netAmount" DECIMAL(12,2) NOT NULL,
  "taxAmount" DECIMAL(12,2) NOT NULL,
  "totalAmount" DECIMAL(12,2) NOT NULL,
  "driveUrl" TEXT,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'EMITIDA',
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "invoices_tenantId_number_key" ON "invoices"("tenantId", "number");
CREATE INDEX "invoices_saleId_idx" ON "invoices"("saleId");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "subscriptions" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL DEFAULT 'cosme',
  "customerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "currency" "Currency" NOT NULL DEFAULT 'CLP',
  "amount" DECIMAL(12,2) NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "renewsAt" TIMESTAMP(3) NOT NULL,
  "hoursIncluded" INTEGER NOT NULL DEFAULT 0,
  "hoursUsed" DECIMAL(8,2) NOT NULL DEFAULT 0,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVA',
  "notes" TEXT,
  "saleId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "subscriptions_customerId_idx" ON "subscriptions"("customerId");
CREATE INDEX "subscriptions_renewsAt_idx" ON "subscriptions"("renewsAt");
CREATE INDEX "subscriptions_tenantId_idx" ON "subscriptions"("tenantId");
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "subscription_hour_logs" (
  "id" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "hours" DECIMAL(6,2) NOT NULL,
  "description" TEXT NOT NULL,
  "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT NOT NULL,
  CONSTRAINT "subscription_hour_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "subscription_hour_logs_subscriptionId_idx" ON "subscription_hour_logs"("subscriptionId");
ALTER TABLE "subscription_hour_logs" ADD CONSTRAINT "subscription_hour_logs_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscription_hour_logs" ADD CONSTRAINT "subscription_hour_logs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Los servicios no llevan stock.
UPDATE "product_variants" SET "tracksStock" = false WHERE "sku" LIKE 'SER-%' OR "sku" LIKE 'DEM-%';

-- Dos ítems de catálogo que las cotizaciones y las renovaciones necesitan
-- para expresar lo que no está en la lista pública.
INSERT INTO "products" ("id","name","description","category","pricingType","active","createdAt","updatedAt") VALUES
  ('cprodmedida0000000000001', 'Proyecto a medida', 'Desarrollo cotizado por proyecto. La descripción del trabajo va en cada línea de la cotización.', 'Servicios', 'COTIZADO', true, now(), now()),
  ('cprodsuscrip0000000000001', 'Suscripción anual de licencia y mantención', 'Cobro recurrente anual: licencia de uso, soporte, mantención correctiva y horas de mejoras incluidas.', 'Servicios', 'SUSCRIPCION', true, now(), now());
INSERT INTO "product_variants" ("id","productId","sku","unit","price","cost","lowStockThreshold","tracksLots","tracksStock","active","createdAt","updatedAt") VALUES
  ('cvarmedida00000000000001', 'cprodmedida0000000000001', 'SER-90-MED', 'UN', 0, 0, 0, false, false, true, now(), now()),
  ('cvarsuscrip00000000000001', 'cprodsuscrip0000000000001', 'SER-91-SUS', 'UN', 0, 0, 0, false, false, true, now(), now());

-- El guion de calificación. 14 preguntas en 5 bloques.
INSERT INTO "qualification_questions" ("id","position","block","text","reason","updatedAt") VALUES
  ('cq01000000000000000000001', 1, 'Quién es', '¿Cuál es tu nombre y el de tu negocio?', 'Identifica al interesado y abre la ficha.', now()),
  ('cq02000000000000000000001', 2, 'Quién es', '¿A qué se dedica el negocio y hace cuánto funciona?', 'Rubro y madurez. Un negocio de dos meses y uno de diez años necesitan cosas distintas.', now()),
  ('cq03000000000000000000001', 3, 'Quién es', '¿Cuántas personas trabajan en él, contándote a ti?', 'Tamaño real. Define si el sistema es para una persona o para un equipo con roles.', now()),
  ('cq04000000000000000000001', 4, 'Cómo trabaja hoy', 'Cuéntame cómo llega un cliente tuyo desde que te contacta hasta que le cobras.', 'La pregunta central. Radiografía el flujo real: reservas, pedidos, atención, cobro.', now()),
  ('cq05000000000000000000001', 5, 'Cómo trabaja hoy', '¿Dónde anotas hoy los pedidos, las horas o el stock: cuaderno, WhatsApp, Excel, alguna app?', 'Herramientas actuales. Lo que se va a reemplazar o a integrar.', now()),
  ('cq06000000000000000000001', 6, 'Cómo trabaja hoy', '¿Cuántos clientes o pedidos atiendes en una semana normal?', 'Volumen. Separa lo que se resuelve con un formulario de lo que necesita un sistema.', now()),
  ('cq07000000000000000000001', 7, 'Dónde duele', '¿Qué es lo que más tiempo te quita o más errores te produce cada semana?', 'El cuello de botella declarado. Es lo que el Diagnóstico va a revisar primero.', now()),
  ('cq08000000000000000000001', 8, 'Dónde duele', '¿Qué te está costando plata hoy por no tener esto resuelto: horas perdidas, clientes que no vuelven, errores de cobro?', 'Traduce el dolor a costo. Sin esto no hay forma de justificar una inversión.', now()),
  ('cq09000000000000000000001', 9, 'Dónde duele', '¿Ya probaste alguna solución antes? ¿Qué pasó?', 'Historial. Evita repetir lo que ya falló y revela expectativas.', now()),
  ('cq10000000000000000000001', 10, 'Decisión', '¿Quién toma la decisión de contratar esto y quién más tiene que estar de acuerdo?', 'Identifica al que firma. Si no es quien escribe, la conversación cambia.', now()),
  ('cq11000000000000000000001', 11, 'Decisión', '¿Tienes un rango de inversión en mente, o prefieres que te oriente con el catálogo?', 'Presupuesto sin incomodar. Ubica al interesado entre el Diagnóstico, una Pieza, un Sistema o algo a medida.', now()),
  ('cq12000000000000000000001', 12, 'Decisión', '¿Para cuándo necesitas tenerlo funcionando, y por qué esa fecha?', 'Urgencia real. Una fecha con motivo es una venta; una fecha sin motivo es una consulta.', now()),
  ('cq13000000000000000000001', 13, 'Cierre', 'Con lo que me cuentas, el primer paso es el Diagnóstico Técnico: una sesión de 60 minutos, informe y cotización, por $80.000 que se descuentan del proyecto si sigues con nosotros. ¿Te acomoda partir por ahí, o prefieres una cotización directa?', 'Propone el camino y bifurca el flujo: Diagnóstico o cotización.', now()),
  ('cq14000000000000000000001', 14, 'Cierre', '¿Por qué medio prefieres que te mande la propuesta, y a qué correo va la factura?', 'Cierra la logística y deja listo el siguiente paso.', now());
