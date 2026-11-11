-- CreateEnum
CREATE TYPE "WhatsAppSpendCapMode" AS ENUM ('WARN', 'BLOCK');

-- CreateEnum
CREATE TYPE "WhatsAppMetaSpendSource" AS ENUM ('META_COST', 'META_VOLUME');

-- AlterTable
ALTER TABLE "whatsapp_cost_entries" ADD COLUMN     "provider_message_id" TEXT,
ADD COLUMN     "reversed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "whatsapp_spend_caps" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "monthly_cap_amount" DECIMAL(12,2) NOT NULL,
    "cap_mode" "WhatsAppSpendCapMode" NOT NULL DEFAULT 'WARN',
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_spend_caps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_meta_spend_snapshots" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "cost" DECIMAL(14,6) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "source" "WhatsAppMetaSpendSource" NOT NULL,
    "by_category" JSONB NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_meta_spend_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_cost_entries_provider_message_id_idx" ON "whatsapp_cost_entries"("provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_spend_caps_connection_id_key" ON "whatsapp_spend_caps"("connection_id");

-- CreateIndex
CREATE INDEX "whatsapp_spend_caps_workspace_id_idx" ON "whatsapp_spend_caps"("workspace_id");

-- CreateIndex
CREATE INDEX "whatsapp_meta_spend_snapshots_workspace_id_idx" ON "whatsapp_meta_spend_snapshots"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_meta_spend_snapshots_connection_id_month_key" ON "whatsapp_meta_spend_snapshots"("connection_id", "month");

-- AddForeignKey
ALTER TABLE "whatsapp_spend_caps" ADD CONSTRAINT "whatsapp_spend_caps_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "whatsapp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_meta_spend_snapshots" ADD CONSTRAINT "whatsapp_meta_spend_snapshots_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "whatsapp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data: refresh the untouched reference prices (BR) to the BRL rate card in
-- force since 2026-10. Only rows still flagged `reference` and holding the
-- old seeded value change; prices an admin saved are never touched, and the
-- ledger keeps the unit price frozen at send time, so history is unchanged.
UPDATE "whatsapp_prices" SET "unit_price" = 0.3217
WHERE "reference" = true AND "country" = 'BR' AND "category" = 'MARKETING' AND "unit_price" = 0.3625;
UPDATE "whatsapp_prices" SET "unit_price" = 0.035
WHERE "reference" = true AND "country" = 'BR' AND "category" = 'UTILITY' AND "unit_price" = 0.04;
UPDATE "whatsapp_prices" SET "unit_price" = 0.035
WHERE "reference" = true AND "country" = 'BR' AND "category" = 'AUTHENTICATION' AND "unit_price" = 0.195;
