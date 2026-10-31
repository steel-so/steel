-- CreateEnum
CREATE TYPE "CrmProspectChannel" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "CrmProspectDraftStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SENT');

-- CreateTable
CREATE TABLE "crm_prospecting_settings" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "monthly_web_limit" INTEGER NOT NULL DEFAULT 300,
    "monthly_draft_limit" INTEGER NOT NULL DEFAULT 100,
    "allowed_channels" "CrmProspectChannel"[],
    "value_proposition" TEXT,
    "signal_keywords" TEXT[],
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_prospecting_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_prospect_drafts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "company_id" TEXT,
    "person_id" TEXT,
    "target_name" TEXT NOT NULL,
    "channel" "CrmProspectChannel" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "to_email" TEXT,
    "to_phone" TEXT,
    "summary" TEXT,
    "signals" JSONB NOT NULL DEFAULT '[]',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "status" "CrmProspectDraftStatus" NOT NULL DEFAULT 'PENDING',
    "agent_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_prospect_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_prospect_usage" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "period" TIMESTAMP(3) NOT NULL,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "fetches" INTEGER NOT NULL DEFAULT 0,
    "drafts" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_prospect_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_prospecting_settings_workspace_id_key" ON "crm_prospecting_settings"("workspace_id");

-- CreateIndex
CREATE INDEX "crm_prospect_drafts_workspace_id_status_created_at_idx" ON "crm_prospect_drafts"("workspace_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "crm_prospect_drafts_workspace_id_lead_id_idx" ON "crm_prospect_drafts"("workspace_id", "lead_id");

-- CreateIndex
CREATE INDEX "crm_prospect_drafts_workspace_id_company_id_idx" ON "crm_prospect_drafts"("workspace_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_prospect_usage_workspace_id_period_key" ON "crm_prospect_usage"("workspace_id", "period");

-- AddForeignKey
ALTER TABLE "crm_prospecting_settings" ADD CONSTRAINT "crm_prospecting_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_prospect_drafts" ADD CONSTRAINT "crm_prospect_drafts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_prospect_usage" ADD CONSTRAINT "crm_prospect_usage_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
