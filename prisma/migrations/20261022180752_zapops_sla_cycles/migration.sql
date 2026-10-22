-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'WHATSAPP_SLA_AT_RISK';
ALTER TYPE "NotificationKind" ADD VALUE 'WHATSAPP_SLA_BREACHED';

-- AlterEnum
ALTER TYPE "WhatsAppConversationEventKind" ADD VALUE 'SLA_BREACHED';

-- AlterEnum
ALTER TYPE "WhatsAppConversationEventSource" ADD VALUE 'SLA';

-- AlterTable
ALTER TABLE "whatsapp_conversations" ADD COLUMN     "first_inbound_at" TIMESTAMP(3),
ADD COLUMN     "first_response_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "whatsapp_sla_policies" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "team_id" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "first_response_minutes" INTEGER NOT NULL DEFAULT 15,
    "resolution_minutes" INTEGER,
    "business_hours_only" BOOLEAN NOT NULL DEFAULT true,
    "warn_at_percent" INTEGER NOT NULL DEFAULT 80,
    "count_ai_as_response" BOOLEAN NOT NULL DEFAULT false,
    "notify_assignee" BOOLEAN NOT NULL DEFAULT true,
    "notify_team_leaders" BOOLEAN NOT NULL DEFAULT true,
    "notify_supervisors" BOOLEAN NOT NULL DEFAULT true,
    "supervisor_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notify_in_app" BOOLEAN NOT NULL DEFAULT true,
    "notify_email" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_sla_cycles" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "policy_id" TEXT,
    "team_id" TEXT,
    "agent_user_id" TEXT,
    "business_hours_only" BOOLEAN NOT NULL DEFAULT false,
    "first_response_minutes" INTEGER NOT NULL,
    "resolution_minutes" INTEGER,
    "count_ai_as_response" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3) NOT NULL,
    "first_response_due_at" TIMESTAMP(3) NOT NULL,
    "first_response_warn_at" TIMESTAMP(3) NOT NULL,
    "resolution_due_at" TIMESTAMP(3),
    "resolution_warn_at" TIMESTAMP(3),
    "first_response_at" TIMESTAMP(3),
    "first_response_seconds" INTEGER,
    "resolved_at" TIMESTAMP(3),
    "first_response_warned_at" TIMESTAMP(3),
    "first_response_breached_at" TIMESTAMP(3),
    "resolution_warned_at" TIMESTAMP(3),
    "resolution_breached_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_sla_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_sla_policies_workspace_id_idx" ON "whatsapp_sla_policies"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_sla_policies_workspace_id_team_id_key" ON "whatsapp_sla_policies"("workspace_id", "team_id");

-- CreateIndex
CREATE INDEX "whatsapp_sla_cycles_conversation_id_started_at_idx" ON "whatsapp_sla_cycles"("conversation_id", "started_at");

-- CreateIndex
CREATE INDEX "whatsapp_sla_cycles_workspace_id_started_at_idx" ON "whatsapp_sla_cycles"("workspace_id", "started_at");

-- CreateIndex
CREATE INDEX "whatsapp_sla_cycles_workspace_id_resolved_at_first_response_idx" ON "whatsapp_sla_cycles"("workspace_id", "resolved_at", "first_response_at");

-- AddForeignKey
ALTER TABLE "whatsapp_sla_policies" ADD CONSTRAINT "whatsapp_sla_policies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_sla_policies" ADD CONSTRAINT "whatsapp_sla_policies_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "whatsapp_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_sla_cycles" ADD CONSTRAINT "whatsapp_sla_cycles_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_sla_cycles" ADD CONSTRAINT "whatsapp_sla_cycles_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
