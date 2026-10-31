-- CreateEnum
CREATE TYPE "WhatsAppBoletoChargeStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'CANCELED', 'REFUNDED');

-- CreateTable
CREATE TABLE "whatsapp_boleto_settings" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_boleto_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_boleto_charges" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "opportunity_id" TEXT,
    "created_by_id" TEXT,
    "provider" TEXT NOT NULL,
    "provider_charge_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" VARCHAR(140) NOT NULL,
    "payer_name" TEXT NOT NULL,
    "payer_tax_id" TEXT NOT NULL,
    "bar_code" TEXT NOT NULL,
    "url" TEXT,
    "due_at" TIMESTAMP(3) NOT NULL,
    "status" "WhatsAppBoletoChargeStatus" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMP(3),
    "paid_amount" DECIMAL(14,2),
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_boleto_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_boleto_settings_workspace_id_key" ON "whatsapp_boleto_settings"("workspace_id");

-- CreateIndex
CREATE INDEX "whatsapp_boleto_charges_workspace_id_conversation_id_create_idx" ON "whatsapp_boleto_charges"("workspace_id", "conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_boleto_charges_opportunity_id_idx" ON "whatsapp_boleto_charges"("opportunity_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_boleto_charges_provider_provider_charge_id_key" ON "whatsapp_boleto_charges"("provider", "provider_charge_id");

-- AddForeignKey
ALTER TABLE "whatsapp_boleto_settings" ADD CONSTRAINT "whatsapp_boleto_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_boleto_charges" ADD CONSTRAINT "whatsapp_boleto_charges_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_boleto_charges" ADD CONSTRAINT "whatsapp_boleto_charges_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_boleto_charges" ADD CONSTRAINT "whatsapp_boleto_charges_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
