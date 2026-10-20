-- CreateEnum
CREATE TYPE "WhatsAppCloseOutcome" AS ENUM ('SUCCESS', 'FAILURE');

-- AlterTable
ALTER TABLE "whatsapp_conversations" ADD COLUMN     "close_outcome" "WhatsAppCloseOutcome",
ADD COLUMN     "close_status_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "close_status_labels" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "whatsapp_conversation_events" ADD COLUMN     "close_outcome" "WhatsAppCloseOutcome",
ADD COLUMN     "close_status_labels" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "whatsapp_settings" ADD COLUMN     "close_status_max_selections" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "close_status_min_selections" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "whatsapp_close_statuses" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "outcome" "WhatsAppCloseOutcome" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_close_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_close_statuses_workspace_id_archived_at_position_idx" ON "whatsapp_close_statuses"("workspace_id", "archived_at", "position");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_workspace_id_close_outcome_idx" ON "whatsapp_conversations"("workspace_id", "close_outcome");

-- AddForeignKey
ALTER TABLE "whatsapp_close_statuses" ADD CONSTRAINT "whatsapp_close_statuses_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

