-- CreateEnum
CREATE TYPE "AiPiiMaskingPolicy" AS ENUM ('OFF', 'AUTO_REPLIES', 'EVERYWHERE');

-- AlterEnum
ALTER TYPE "AiUsageFeature" ADD VALUE 'AI_GUARDRAIL';

-- AlterEnum
ALTER TYPE "WhatsAppConversationEventKind" ADD VALUE 'AI_GUARDRAIL_HANDOFF';

-- AlterEnum
ALTER TYPE "WhatsAppConversationEventSource" ADD VALUE 'AI_GUARDRAIL';

-- AlterTable
ALTER TABLE "platform_ai_settings" ADD COLUMN     "agent_model" TEXT,
ADD COLUMN     "assistant_model" TEXT,
ADD COLUMN     "classification_model" TEXT,
ADD COLUMN     "conversation_model" TEXT,
ADD COLUMN     "failover_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "workspace_ai_settings" ADD COLUMN     "agent_model" TEXT,
ADD COLUMN     "failover_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "workspace_ai_guardrails" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "pii_masking_policy" "AiPiiMaskingPolicy" NOT NULL DEFAULT 'AUTO_REPLIES',
    "injection_classifier_enabled" BOOLEAN NOT NULL DEFAULT false,
    "forbidden_topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "max_discount_percent" INTEGER,
    "max_refund_amount" DECIMAL(12,2),
    "max_deadline_days" INTEGER,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_ai_guardrails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_ai_guardrails_workspace_id_key" ON "workspace_ai_guardrails"("workspace_id");

-- AddForeignKey
ALTER TABLE "workspace_ai_guardrails" ADD CONSTRAINT "workspace_ai_guardrails_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
