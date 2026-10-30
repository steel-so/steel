-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'WHATSAPP_SURVEY_DETRACTOR';

-- AlterEnum
ALTER TYPE "WhatsAppConversationEventKind" ADD VALUE 'TRANSFER_SUMMARY';

-- AlterEnum
ALTER TYPE "WhatsAppConversationEventSource" ADD VALUE 'COPILOT';

-- AlterTable
ALTER TABLE "satisfaction_survey_configs" ADD COLUMN     "alert_detractors" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "detractor_max_score" INTEGER;

-- AlterTable
ALTER TABLE "whatsapp_settings" ADD COLUMN     "copilot_summary_on_transfer" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "whatsapp_chatbot_node_stats" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "chatbot_id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "entries" INTEGER NOT NULL DEFAULT 0,
    "exits" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "whatsapp_chatbot_node_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_chatbot_node_stats_workspace_id_day_idx" ON "whatsapp_chatbot_node_stats"("workspace_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_chatbot_node_stats_chatbot_id_node_id_day_key" ON "whatsapp_chatbot_node_stats"("chatbot_id", "node_id", "day");

-- AddForeignKey
ALTER TABLE "whatsapp_chatbot_node_stats" ADD CONSTRAINT "whatsapp_chatbot_node_stats_chatbot_id_fkey" FOREIGN KEY ("chatbot_id") REFERENCES "whatsapp_chatbots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
