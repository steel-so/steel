-- CreateTable
CREATE TABLE "whatsapp_ad_settings" (
    "workspace_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "create_leads" BOOLEAN NOT NULL DEFAULT false,
    "lead_owner_id" TEXT,
    "lead_source" VARCHAR(60) NOT NULL DEFAULT 'Anúncio Click-to-WhatsApp',
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_ad_settings_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "whatsapp_ad_referrals" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "source_type" VARCHAR(20) NOT NULL,
    "source_id" VARCHAR(100) NOT NULL,
    "source_url" VARCHAR(1000),
    "headline" VARCHAR(300),
    "body" VARCHAR(1000),
    "media_type" VARCHAR(20),
    "media_url" VARCHAR(1000),
    "ctwa_clid" VARCHAR(500),
    "lead_id" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_ad_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_ad_spends" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "source_id" VARCHAR(100) NOT NULL,
    "label" VARCHAR(200),
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" VARCHAR(500),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_ad_spends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_ad_referrals_provider_message_id_key" ON "whatsapp_ad_referrals"("provider_message_id");

-- CreateIndex
CREATE INDEX "whatsapp_ad_referrals_workspace_id_received_at_idx" ON "whatsapp_ad_referrals"("workspace_id", "received_at");

-- CreateIndex
CREATE INDEX "whatsapp_ad_referrals_workspace_id_source_id_idx" ON "whatsapp_ad_referrals"("workspace_id", "source_id");

-- CreateIndex
CREATE INDEX "whatsapp_ad_referrals_conversation_id_idx" ON "whatsapp_ad_referrals"("conversation_id");

-- CreateIndex
CREATE INDEX "whatsapp_ad_referrals_lead_id_idx" ON "whatsapp_ad_referrals"("lead_id");

-- CreateIndex
CREATE INDEX "whatsapp_ad_spends_workspace_id_source_id_idx" ON "whatsapp_ad_spends"("workspace_id", "source_id");

-- CreateIndex
CREATE INDEX "whatsapp_ad_spends_workspace_id_period_start_period_end_idx" ON "whatsapp_ad_spends"("workspace_id", "period_start", "period_end");

-- AddForeignKey
ALTER TABLE "whatsapp_ad_settings" ADD CONSTRAINT "whatsapp_ad_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_ad_referrals" ADD CONSTRAINT "whatsapp_ad_referrals_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_ad_spends" ADD CONSTRAINT "whatsapp_ad_spends_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
