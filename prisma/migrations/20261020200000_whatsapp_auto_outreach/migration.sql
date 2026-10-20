-- CreateEnum
CREATE TYPE "WhatsAppAutoOutreachStatus" AS ENUM ('IDLE', 'RUNNING', 'PAUSED', 'DONE');

-- CreateEnum
CREATE TYPE "WhatsAppAutoOutreachRecipientStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- AlterEnum
ALTER TYPE "WhatsAppConversationEventSource" ADD VALUE 'AUTO_OUTREACH';

-- CreateTable
CREATE TABLE "whatsapp_auto_outreaches" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "connection_id" TEXT,
    "template_id" TEXT,
    "status" "WhatsAppAutoOutreachStatus" NOT NULL DEFAULT 'IDLE',
    "run_token" TEXT,
    "last_sent_at" TIMESTAMP(3),
    "last_error" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_auto_outreaches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_auto_outreach_recipients" (
    "id" TEXT NOT NULL,
    "outreach_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "status" "WhatsAppAutoOutreachRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "provider_message_id" TEXT,
    "error_message" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_auto_outreach_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_auto_outreaches_workspace_id_key" ON "whatsapp_auto_outreaches"("workspace_id");

-- CreateIndex
CREATE INDEX "whatsapp_auto_outreach_recipients_outreach_id_status_create_idx" ON "whatsapp_auto_outreach_recipients"("outreach_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_auto_outreach_recipients_contact_id_idx" ON "whatsapp_auto_outreach_recipients"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_auto_outreach_recipients_outreach_id_contact_id_key" ON "whatsapp_auto_outreach_recipients"("outreach_id", "contact_id");

-- AddForeignKey
ALTER TABLE "whatsapp_auto_outreaches" ADD CONSTRAINT "whatsapp_auto_outreaches_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_auto_outreaches" ADD CONSTRAINT "whatsapp_auto_outreaches_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "whatsapp_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_auto_outreaches" ADD CONSTRAINT "whatsapp_auto_outreaches_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "whatsapp_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_auto_outreach_recipients" ADD CONSTRAINT "whatsapp_auto_outreach_recipients_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "whatsapp_auto_outreaches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_auto_outreach_recipients" ADD CONSTRAINT "whatsapp_auto_outreach_recipients_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "whatsapp_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

