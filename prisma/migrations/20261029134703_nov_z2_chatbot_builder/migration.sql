-- CreateEnum
CREATE TYPE "WhatsAppChatbotStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "WhatsAppChatbotTrigger" AS ENUM ('NEW_CONVERSATION', 'KEYWORD', 'OUTSIDE_BUSINESS_HOURS');

-- CreateEnum
CREATE TYPE "WhatsAppChatbotSessionStatus" AS ENUM ('RUNNING', 'HANDED_OFF_HUMAN', 'HANDED_OFF_AI', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'FAILED');

-- AlterEnum
ALTER TYPE "WhatsAppConversationEventKind" ADD VALUE 'CHATBOT_HANDOFF';

-- AlterEnum
ALTER TYPE "WhatsAppConversationEventSource" ADD VALUE 'CHATBOT';

-- CreateTable
CREATE TABLE "whatsapp_chatbots" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "connection_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "WhatsAppChatbotStatus" NOT NULL DEFAULT 'DRAFT',
    "trigger_kind" "WhatsAppChatbotTrigger" NOT NULL DEFAULT 'NEW_CONVERSATION',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "session_ttl_minutes" INTEGER NOT NULL DEFAULT 720,
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "published_version" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_chatbots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_chatbot_sessions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "chatbot_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "status" "WhatsAppChatbotSessionStatus" NOT NULL DEFAULT 'RUNNING',
    "bot_version" INTEGER NOT NULL,
    "state" JSONB NOT NULL,
    "definition" JSONB NOT NULL,
    "end_reason" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "whatsapp_chatbot_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_chatbots_workspace_id_status_idx" ON "whatsapp_chatbots"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "whatsapp_chatbots_connection_id_idx" ON "whatsapp_chatbots"("connection_id");

-- CreateIndex
CREATE INDEX "whatsapp_chatbot_sessions_conversation_id_status_idx" ON "whatsapp_chatbot_sessions"("conversation_id", "status");

-- CreateIndex
CREATE INDEX "whatsapp_chatbot_sessions_chatbot_id_status_idx" ON "whatsapp_chatbot_sessions"("chatbot_id", "status");

-- CreateIndex
CREATE INDEX "whatsapp_chatbot_sessions_workspace_id_started_at_idx" ON "whatsapp_chatbot_sessions"("workspace_id", "started_at");

-- AddForeignKey
ALTER TABLE "whatsapp_chatbots" ADD CONSTRAINT "whatsapp_chatbots_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_chatbots" ADD CONSTRAINT "whatsapp_chatbots_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "whatsapp_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_chatbots" ADD CONSTRAINT "whatsapp_chatbots_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_chatbot_sessions" ADD CONSTRAINT "whatsapp_chatbot_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_chatbot_sessions" ADD CONSTRAINT "whatsapp_chatbot_sessions_chatbot_id_fkey" FOREIGN KEY ("chatbot_id") REFERENCES "whatsapp_chatbots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_chatbot_sessions" ADD CONSTRAINT "whatsapp_chatbot_sessions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One RUNNING session per conversation (Prisma cannot express a partial index).
CREATE UNIQUE INDEX "whatsapp_chatbot_sessions_running_conversation_key" ON "whatsapp_chatbot_sessions"("conversation_id") WHERE "status" = 'RUNNING';
