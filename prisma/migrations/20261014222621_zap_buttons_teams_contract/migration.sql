-- CreateEnum
CREATE TYPE "WhatsAppTemplateQuality" AS ENUM ('GREEN', 'YELLOW', 'RED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "WhatsAppTemplateHeaderFormat" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "WhatsAppTeamRole" AS ENUM ('LEADER', 'AGENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WhatsAppConversationEventKind" ADD VALUE 'BUTTON_CLICKED';
ALTER TYPE "WhatsAppConversationEventKind" ADD VALUE 'ASSIGNED';
ALTER TYPE "WhatsAppConversationEventKind" ADD VALUE 'TEAM_CHANGED';

-- AlterEnum
ALTER TYPE "WhatsAppConversationEventSource" ADD VALUE 'BUTTON_ACTION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WhatsAppTemplateStatus" ADD VALUE 'PAUSED';
ALTER TYPE "WhatsAppTemplateStatus" ADD VALUE 'DISABLED';

-- AlterTable
ALTER TABLE "whatsapp_conversations" ADD COLUMN     "team_id" TEXT;

-- AlterTable
ALTER TABLE "whatsapp_messages" ADD COLUMN     "button_payload" TEXT,
ADD COLUMN     "buttons" JSONB;

-- AlterTable
ALTER TABLE "whatsapp_quick_replies" ADD COLUMN     "buttons" JSONB;

-- AlterTable
ALTER TABLE "whatsapp_templates" ADD COLUMN     "buttons" JSONB,
ADD COLUMN     "header_format" "WhatsAppTemplateHeaderFormat",
ADD COLUMN     "header_media_url" TEXT,
ADD COLUMN     "quality" "WhatsAppTemplateQuality" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "quality_updated_at" TIMESTAMP(3),
ADD COLUMN     "status_reason" TEXT;

-- CreateTable
CREATE TABLE "whatsapp_teams" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_team_members" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "WhatsAppTeamRole" NOT NULL DEFAULT 'AGENT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_teams_workspace_id_idx" ON "whatsapp_teams"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_teams_workspace_id_name_key" ON "whatsapp_teams"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "whatsapp_team_members_user_id_idx" ON "whatsapp_team_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_team_members_team_id_user_id_key" ON "whatsapp_team_members"("team_id", "user_id");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_team_id_idx" ON "whatsapp_conversations"("team_id");

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "whatsapp_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_teams" ADD CONSTRAINT "whatsapp_teams_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_team_members" ADD CONSTRAINT "whatsapp_team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "whatsapp_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_team_members" ADD CONSTRAINT "whatsapp_team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
