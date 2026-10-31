-- CreateEnum
CREATE TYPE "QaSubjectType" AS ENUM ('CONVERSATION', 'TICKET');

-- CreateEnum
CREATE TYPE "QaReviewStatus" AS ENUM ('PENDING', 'COMPLETED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "QaHandlerKind" AS ENUM ('HUMAN', 'BOT', 'MIXED');

-- CreateEnum
CREATE TYPE "QaCriterionScope" AS ENUM ('BOTH', 'CONVERSATION', 'TICKET');

-- AlterEnum
ALTER TYPE "AiUsageFeature" ADD VALUE 'QA_REVIEW';

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'QA_LOW_SCORE';

-- CreateTable
CREATE TABLE "qa_review_configs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "review_conversations" BOOLEAN NOT NULL DEFAULT true,
    "review_tickets" BOOLEAN NOT NULL DEFAULT true,
    "include_bots" BOOLEAN NOT NULL DEFAULT true,
    "min_messages" INTEGER NOT NULL DEFAULT 4,
    "low_score_threshold" INTEGER NOT NULL DEFAULT 60,
    "alert_low_score" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qa_review_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qa_criteria" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "applies_to" "QaCriterionScope" NOT NULL DEFAULT 'BOTH',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qa_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qa_reviews" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "subject_type" "QaSubjectType" NOT NULL,
    "conversation_id" TEXT,
    "ticket_id" TEXT,
    "subject_label" TEXT,
    "status" "QaReviewStatus" NOT NULL DEFAULT 'PENDING',
    "handler_kind" "QaHandlerKind",
    "agent_user_id" TEXT,
    "agent_name" TEXT,
    "customer_name" TEXT,
    "score" INTEGER,
    "summary" TEXT,
    "criteria_results" JSONB NOT NULL DEFAULT '[]',
    "coaching_tips" JSONB NOT NULL DEFAULT '[]',
    "low_score" BOOLEAN NOT NULL DEFAULT false,
    "skip_reason" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "subject_ended_at" TIMESTAMP(3),
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qa_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qa_review_configs_workspace_id_key" ON "qa_review_configs"("workspace_id");

-- CreateIndex
CREATE INDEX "qa_criteria_workspace_id_active_position_idx" ON "qa_criteria"("workspace_id", "active", "position");

-- CreateIndex
CREATE UNIQUE INDEX "qa_criteria_workspace_id_key_key" ON "qa_criteria"("workspace_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "qa_reviews_conversation_id_key" ON "qa_reviews"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "qa_reviews_ticket_id_key" ON "qa_reviews"("ticket_id");

-- CreateIndex
CREATE INDEX "qa_reviews_workspace_id_status_reviewed_at_idx" ON "qa_reviews"("workspace_id", "status", "reviewed_at");

-- CreateIndex
CREATE INDEX "qa_reviews_workspace_id_agent_user_id_reviewed_at_idx" ON "qa_reviews"("workspace_id", "agent_user_id", "reviewed_at");

-- CreateIndex
CREATE INDEX "qa_reviews_workspace_id_low_score_reviewed_at_idx" ON "qa_reviews"("workspace_id", "low_score", "reviewed_at");

-- AddForeignKey
ALTER TABLE "qa_review_configs" ADD CONSTRAINT "qa_review_configs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_criteria" ADD CONSTRAINT "qa_criteria_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_reviews" ADD CONSTRAINT "qa_reviews_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
