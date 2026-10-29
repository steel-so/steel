-- CreateEnum
CREATE TYPE "WhatsAppFlowStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "WhatsAppFlowCrmAction" AS ENUM ('NONE', 'LEAD', 'PERSON', 'COMPANY');

-- CreateEnum
CREATE TYPE "WhatsAppFlowResponseStatus" AS ENUM ('SENT', 'COMPLETED');

-- CreateTable
CREATE TABLE "whatsapp_flows" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "status" "WhatsAppFlowStatus" NOT NULL DEFAULT 'DRAFT',
    "definition" JSONB NOT NULL,
    "published_definition" JSONB,
    "published_version" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "meta_flow_id" TEXT,
    "meta_status" TEXT,
    "publish_error" TEXT,
    "body_text" TEXT NOT NULL DEFAULT 'Preencha o formulário para continuar.',
    "cta_label" TEXT NOT NULL DEFAULT 'Preencher',
    "confirmation_text" TEXT,
    "crm_action" "WhatsAppFlowCrmAction" NOT NULL DEFAULT 'NONE',
    "source_crm_form_id" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_flow_responses" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "flow_token" TEXT NOT NULL,
    "status" "WhatsAppFlowResponseStatus" NOT NULL DEFAULT 'SENT',
    "sent_by_user_id" TEXT,
    "provider_message_id" TEXT,
    "answers" JSONB,
    "created_lead_id" TEXT,
    "created_person_id" TEXT,
    "created_company_id" TEXT,
    "mapping_note" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),

    CONSTRAINT "whatsapp_flow_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_flows_workspace_id_status_idx" ON "whatsapp_flows"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "whatsapp_flows_connection_id_idx" ON "whatsapp_flows"("connection_id");

-- CreateIndex
CREATE INDEX "whatsapp_flows_meta_flow_id_idx" ON "whatsapp_flows"("meta_flow_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_flow_responses_flow_token_key" ON "whatsapp_flow_responses"("flow_token");

-- CreateIndex
CREATE INDEX "whatsapp_flow_responses_flow_id_status_idx" ON "whatsapp_flow_responses"("flow_id", "status");

-- CreateIndex
CREATE INDEX "whatsapp_flow_responses_workspace_id_sent_at_idx" ON "whatsapp_flow_responses"("workspace_id", "sent_at");

-- CreateIndex
CREATE INDEX "whatsapp_flow_responses_contact_id_idx" ON "whatsapp_flow_responses"("contact_id");

-- CreateIndex
CREATE INDEX "whatsapp_flow_responses_conversation_id_status_idx" ON "whatsapp_flow_responses"("conversation_id", "status");

-- AddForeignKey
ALTER TABLE "whatsapp_flows" ADD CONSTRAINT "whatsapp_flows_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_flow_responses" ADD CONSTRAINT "whatsapp_flow_responses_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_flow_responses" ADD CONSTRAINT "whatsapp_flow_responses_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "whatsapp_flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_flow_responses" ADD CONSTRAINT "whatsapp_flow_responses_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "whatsapp_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
