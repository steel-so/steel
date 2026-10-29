-- CreateEnum
CREATE TYPE "WhatsAppPixChargeStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'CANCELED');

-- AlterEnum
ALTER TYPE "WhatsAppConversationEventKind" ADD VALUE 'PIX_PAID';

-- AlterEnum
ALTER TYPE "WhatsAppConversationEventSource" ADD VALUE 'PIX';

-- CreateTable
CREATE TABLE "whatsapp_pix_settings" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "default_expires_minutes" INTEGER NOT NULL DEFAULT 60,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_pix_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_pix_charges" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "opportunity_id" TEXT,
    "created_by_id" TEXT,
    "created_by_ai" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL,
    "provider_charge_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" VARCHAR(140) NOT NULL,
    "br_code" TEXT NOT NULL,
    "status" "WhatsAppPixChargeStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "paid_amount" DECIMAL(14,2),
    "end_to_end_id" TEXT,
    "payer_name" TEXT,
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_pix_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_pix_settings_workspace_id_key" ON "whatsapp_pix_settings"("workspace_id");

-- CreateIndex
CREATE INDEX "whatsapp_pix_charges_workspace_id_conversation_id_created_a_idx" ON "whatsapp_pix_charges"("workspace_id", "conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_pix_charges_opportunity_id_idx" ON "whatsapp_pix_charges"("opportunity_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_pix_charges_provider_provider_charge_id_key" ON "whatsapp_pix_charges"("provider", "provider_charge_id");

-- AddForeignKey
ALTER TABLE "whatsapp_pix_settings" ADD CONSTRAINT "whatsapp_pix_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_pix_charges" ADD CONSTRAINT "whatsapp_pix_charges_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_pix_charges" ADD CONSTRAINT "whatsapp_pix_charges_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_pix_charges" ADD CONSTRAINT "whatsapp_pix_charges_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
