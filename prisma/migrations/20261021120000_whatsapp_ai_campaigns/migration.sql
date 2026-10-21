-- CreateEnum
CREATE TYPE "WhatsAppAiCampaignStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'DONE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WhatsAppAiCampaignRecipientStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WhatsAppAiCampaignActionRunStatus" AS ENUM ('SUCCESS', 'FAILED');

-- AlterEnum
ALTER TYPE "WhatsAppOptOutSource" ADD VALUE 'AI';

-- AlterEnum
ALTER TYPE "WhatsAppConversationEventKind" ADD VALUE 'AI_ACTION';

-- AlterEnum
ALTER TYPE "WhatsAppConversationEventSource" ADD VALUE 'AI_CAMPAIGN';

-- AlterTable
ALTER TABLE "whatsapp_conversations" ADD COLUMN     "ai_campaign_id" TEXT;

-- CreateTable
CREATE TABLE "whatsapp_ai_campaigns" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "objective" VARCHAR(500),
    "connection_id" TEXT,
    "template_id" TEXT,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "header_media_url" TEXT,
    "instructions" TEXT NOT NULL DEFAULT '',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "interval_seconds" INTEGER NOT NULL DEFAULT 30,
    "ai_replies" BOOLEAN NOT NULL DEFAULT true,
    "status" "WhatsAppAiCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "run_token" TEXT,
    "last_sent_at" TIMESTAMP(3),
    "last_error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_ai_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_ai_campaign_recipients" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "status" "WhatsAppAiCampaignRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "values" JSONB,
    "conversation_id" TEXT,
    "provider_message_id" TEXT,
    "error_message" TEXT,
    "sent_at" TIMESTAMP(3),
    "replied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_ai_campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_ai_campaign_action_runs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "contact_id" TEXT,
    "action_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "reason" TEXT,
    "payload" JSONB,
    "status" "WhatsAppAiCampaignActionRunStatus" NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_ai_campaign_action_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_ai_campaigns_workspace_id_status_idx" ON "whatsapp_ai_campaigns"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "whatsapp_ai_campaign_recipients_campaign_id_status_created__idx" ON "whatsapp_ai_campaign_recipients"("campaign_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_ai_campaign_recipients_conversation_id_idx" ON "whatsapp_ai_campaign_recipients"("conversation_id");

-- CreateIndex
CREATE INDEX "whatsapp_ai_campaign_recipients_contact_id_idx" ON "whatsapp_ai_campaign_recipients"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_ai_campaign_recipients_campaign_id_contact_id_key" ON "whatsapp_ai_campaign_recipients"("campaign_id", "contact_id");

-- CreateIndex
CREATE INDEX "whatsapp_ai_campaign_action_runs_campaign_id_created_at_idx" ON "whatsapp_ai_campaign_action_runs"("campaign_id", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_ai_campaign_action_runs_workspace_id_idx" ON "whatsapp_ai_campaign_action_runs"("workspace_id");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_ai_campaign_id_idx" ON "whatsapp_conversations"("ai_campaign_id");

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_ai_campaign_id_fkey" FOREIGN KEY ("ai_campaign_id") REFERENCES "whatsapp_ai_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_ai_campaigns" ADD CONSTRAINT "whatsapp_ai_campaigns_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_ai_campaigns" ADD CONSTRAINT "whatsapp_ai_campaigns_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "whatsapp_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_ai_campaigns" ADD CONSTRAINT "whatsapp_ai_campaigns_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "whatsapp_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_ai_campaign_recipients" ADD CONSTRAINT "whatsapp_ai_campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "whatsapp_ai_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_ai_campaign_recipients" ADD CONSTRAINT "whatsapp_ai_campaign_recipients_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "whatsapp_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_ai_campaign_action_runs" ADD CONSTRAINT "whatsapp_ai_campaign_action_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_ai_campaign_action_runs" ADD CONSTRAINT "whatsapp_ai_campaign_action_runs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "whatsapp_ai_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate the auto outreach (Contatos page) into an AI campaign: same id,
-- so its queue keeps the history. A run in progress comes back paused; the
-- template variables must be filled in the campaign before playing again.
INSERT INTO "whatsapp_ai_campaigns" ("id", "workspace_id", "name", "objective", "connection_id", "template_id", "interval_seconds", "status", "last_sent_at", "created_by_id", "updated_by_id", "created_at", "updated_at")
SELECT "id", "workspace_id", 'Disparo automático', 'Migrada do disparo automático da página de Contatos.', "connection_id", "template_id", "interval_seconds",
  (CASE
    WHEN "template_id" IS NULL THEN 'DRAFT'
    WHEN "status" = 'DONE' THEN 'DONE'
    ELSE 'PAUSED'
  END)::"WhatsAppAiCampaignStatus",
  "last_sent_at", "updated_by_id", "updated_by_id", "created_at", "updated_at"
FROM "whatsapp_auto_outreaches";

INSERT INTO "whatsapp_ai_campaign_recipients" ("id", "campaign_id", "contact_id", "status", "provider_message_id", "error_message", "sent_at", "created_at")
SELECT "id", "outreach_id", "contact_id", ("status"::text)::"WhatsAppAiCampaignRecipientStatus", "provider_message_id", "error_message", "sent_at", "created_at"
FROM "whatsapp_auto_outreach_recipients";

-- DropForeignKey
ALTER TABLE "whatsapp_auto_outreaches" DROP CONSTRAINT "whatsapp_auto_outreaches_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "whatsapp_auto_outreaches" DROP CONSTRAINT "whatsapp_auto_outreaches_connection_id_fkey";

-- DropForeignKey
ALTER TABLE "whatsapp_auto_outreaches" DROP CONSTRAINT "whatsapp_auto_outreaches_template_id_fkey";

-- DropForeignKey
ALTER TABLE "whatsapp_auto_outreach_recipients" DROP CONSTRAINT "whatsapp_auto_outreach_recipients_outreach_id_fkey";

-- DropForeignKey
ALTER TABLE "whatsapp_auto_outreach_recipients" DROP CONSTRAINT "whatsapp_auto_outreach_recipients_contact_id_fkey";

-- DropTable
DROP TABLE "whatsapp_auto_outreaches";

-- DropTable
DROP TABLE "whatsapp_auto_outreach_recipients";

-- DropEnum
DROP TYPE "WhatsAppAutoOutreachStatus";

-- DropEnum
DROP TYPE "WhatsAppAutoOutreachRecipientStatus";
