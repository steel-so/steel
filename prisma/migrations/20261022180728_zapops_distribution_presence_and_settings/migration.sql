-- CreateEnum
CREATE TYPE "WhatsAppDistributionMode" AS ENUM ('OFF', 'ROUND_ROBIN', 'LEAST_LOADED');

-- CreateEnum
CREATE TYPE "WhatsAppPresenceStatus" AS ENUM ('AVAILABLE', 'AWAY');

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'WHATSAPP_CONVERSATION_UNATTENDED';

-- AlterEnum
ALTER TYPE "WhatsAppConversationEventSource" ADD VALUE 'DISTRIBUTION';

-- AlterTable
ALTER TABLE "whatsapp_conversations" ADD COLUMN     "queued_at" TIMESTAMP(3),
ADD COLUMN     "unassigned_reminder_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "whatsapp_settings" ADD COLUMN     "distribution_last_assigned_user_id" TEXT,
ADD COLUMN     "distribution_max_open_per_agent" INTEGER,
ADD COLUMN     "distribution_mode" "WhatsAppDistributionMode" NOT NULL DEFAULT 'OFF',
ADD COLUMN     "distribution_only_available" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "distribution_respect_business_hours" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "unassigned_alert_notify_email" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unassigned_alert_notify_in_app" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "unassigned_reminder_minutes" INTEGER NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "whatsapp_teams" ADD COLUMN     "distribution_last_assigned_user_id" TEXT;

-- CreateTable
CREATE TABLE "whatsapp_agent_presence" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "WhatsAppPresenceStatus" NOT NULL DEFAULT 'AVAILABLE',
    "last_assigned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_agent_presence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_agent_presence_user_id_idx" ON "whatsapp_agent_presence"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_agent_presence_workspace_id_user_id_key" ON "whatsapp_agent_presence"("workspace_id", "user_id");

-- AddForeignKey
ALTER TABLE "whatsapp_agent_presence" ADD CONSTRAINT "whatsapp_agent_presence_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_agent_presence" ADD CONSTRAINT "whatsapp_agent_presence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
