-- CreateEnum
CREATE TYPE "AiInsightKind" AS ENUM ('SD_SLA_BREACH_FORECAST', 'CRM_STALE_OPPORTUNITIES', 'CRM_STALLED_STAGE', 'CRM_FORECAST_GAP', 'ZAP_WAITING_TOO_LONG', 'ZAP_NEGATIVE_SENTIMENT');

-- CreateEnum
CREATE TYPE "AiInsightSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AiInsightStatus" AS ENUM ('ACTIVE', 'RESOLVED');

-- AlterEnum
ALTER TYPE "AiUsageFeature" ADD VALUE 'PROACTIVE_DIGEST';

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'AI_DAILY_DIGEST';

-- AlterTable
ALTER TABLE "workspace_ai_settings" ADD COLUMN     "proactive_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ai_insights" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "AiInsightKind" NOT NULL,
    "module" "ModuleKind" NOT NULL,
    "severity" "AiInsightSeverity" NOT NULL DEFAULT 'INFO',
    "dedupe_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "facts" JSONB NOT NULL DEFAULT '[]',
    "href" TEXT,
    "prompt" TEXT,
    "status" "AiInsightStatus" NOT NULL DEFAULT 'ACTIVE',
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "snoozed_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_digest_settings" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "last_sent_on" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_digest_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_insights_user_id_workspace_id_status_idx" ON "ai_insights"("user_id", "workspace_id", "status");

-- CreateIndex
CREATE INDEX "ai_insights_workspace_id_status_module_idx" ON "ai_insights"("workspace_id", "status", "module");

-- CreateIndex
CREATE INDEX "ai_insights_status_resolved_at_idx" ON "ai_insights"("status", "resolved_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_insights_user_id_workspace_id_dedupe_key_key" ON "ai_insights"("user_id", "workspace_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_digest_settings_user_id_workspace_id_key" ON "ai_digest_settings"("user_id", "workspace_id");

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_digest_settings" ADD CONSTRAINT "ai_digest_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_digest_settings" ADD CONSTRAINT "ai_digest_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
