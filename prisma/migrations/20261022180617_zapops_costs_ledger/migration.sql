-- CreateEnum
CREATE TYPE "WhatsAppCostCategory" AS ENUM ('MARKETING', 'UTILITY', 'AUTHENTICATION', 'SERVICE');

-- CreateEnum
CREATE TYPE "WhatsAppCostKind" AS ENUM ('TEMPLATE', 'SERVICE');

-- CreateEnum
CREATE TYPE "WhatsAppCostSource" AS ENUM ('BROADCAST', 'AI_CAMPAIGN', 'CRM_CAMPAIGN', 'AGENT', 'AI_REPLY', 'BUTTON', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'WHATSAPP_COST_BUDGET_WARNING';
ALTER TYPE "NotificationKind" ADD VALUE 'WHATSAPP_COST_BUDGET_REACHED';

-- AlterTable
ALTER TABLE "whatsapp_connections" ADD COLUMN     "monthly_fee" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "whatsapp_settings" ADD COLUMN     "monthly_cost_budget" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "whatsapp_prices" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "category" "WhatsAppCostCategory" NOT NULL,
    "country" VARCHAR(2) NOT NULL DEFAULT 'BR',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "unit_price" DECIMAL(12,6) NOT NULL,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "reference" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_cost_entries" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "provider" "WhatsAppProvider" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" "WhatsAppCostCategory" NOT NULL,
    "kind" "WhatsAppCostKind" NOT NULL,
    "source" "WhatsAppCostSource" NOT NULL,
    "country" VARCHAR(2) NOT NULL DEFAULT 'BR',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "broadcast_id" TEXT,
    "ai_campaign_id" TEXT,
    "conversation_id" TEXT,
    "user_id" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(12,6) NOT NULL,
    "estimated_cost" DECIMAL(14,6) NOT NULL,

    CONSTRAINT "whatsapp_cost_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_prices_workspace_id_idx" ON "whatsapp_prices"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_prices_workspace_id_category_country_valid_from_key" ON "whatsapp_prices"("workspace_id", "category", "country", "valid_from");

-- CreateIndex
CREATE INDEX "whatsapp_cost_entries_workspace_id_occurred_at_idx" ON "whatsapp_cost_entries"("workspace_id", "occurred_at");

-- CreateIndex
CREATE INDEX "whatsapp_cost_entries_connection_id_occurred_at_idx" ON "whatsapp_cost_entries"("connection_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "whatsapp_prices" ADD CONSTRAINT "whatsapp_prices_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_cost_entries" ADD CONSTRAINT "whatsapp_cost_entries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_cost_entries" ADD CONSTRAINT "whatsapp_cost_entries_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "whatsapp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
