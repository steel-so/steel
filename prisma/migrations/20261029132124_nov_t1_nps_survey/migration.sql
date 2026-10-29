-- CreateEnum
CREATE TYPE "SatisfactionSurveyKind" AS ENUM ('NPS', 'CSAT', 'CES');

-- CreateEnum
CREATE TYPE "SatisfactionSurveyTrigger" AS ENUM ('CONVERSATION_CLOSED', 'TICKET_RESOLVED', 'MANUAL');

-- CreateEnum
CREATE TYPE "SatisfactionSurveyChannel" AS ENUM ('WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "SatisfactionSurveyStatus" AS ENUM ('SCHEDULED', 'SENT', 'ANSWERED', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "satisfaction_survey_configs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "trigger" "SatisfactionSurveyTrigger" NOT NULL,
    "kind" "SatisfactionSurveyKind" NOT NULL DEFAULT 'CSAT',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "delay_minutes" INTEGER NOT NULL DEFAULT 5,
    "expires_in_hours" INTEGER NOT NULL DEFAULT 72,
    "cooldown_days" INTEGER NOT NULL DEFAULT 30,
    "email_fallback" BOOLEAN NOT NULL DEFAULT true,
    "question_text" TEXT,
    "thank_you_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "satisfaction_survey_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "satisfaction_surveys" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "config_id" TEXT,
    "kind" "SatisfactionSurveyKind" NOT NULL,
    "trigger" "SatisfactionSurveyTrigger" NOT NULL,
    "channel" "SatisfactionSurveyChannel" NOT NULL,
    "status" "SatisfactionSurveyStatus" NOT NULL DEFAULT 'SCHEDULED',
    "token" TEXT NOT NULL,
    "conversation_id" TEXT,
    "ticket_id" TEXT,
    "connection_id" TEXT,
    "recipient_phone" TEXT,
    "recipient_email" TEXT,
    "recipient_name" TEXT,
    "customer_key" TEXT,
    "customer_name" TEXT,
    "assignee_user_id" TEXT,
    "assignee_name" TEXT,
    "team_id" TEXT,
    "team_name" TEXT,
    "score" INTEGER,
    "comment" TEXT,
    "provider_message_id" TEXT,
    "failure_reason" TEXT,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "answered_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "satisfaction_surveys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "satisfaction_survey_configs_workspace_id_trigger_key" ON "satisfaction_survey_configs"("workspace_id", "trigger");

-- CreateIndex
CREATE UNIQUE INDEX "satisfaction_surveys_token_key" ON "satisfaction_surveys"("token");

-- CreateIndex
CREATE INDEX "satisfaction_surveys_workspace_id_answered_at_idx" ON "satisfaction_surveys"("workspace_id", "answered_at");

-- CreateIndex
CREATE INDEX "satisfaction_surveys_workspace_id_created_at_idx" ON "satisfaction_surveys"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "satisfaction_surveys_workspace_id_recipient_phone_status_idx" ON "satisfaction_surveys"("workspace_id", "recipient_phone", "status");

-- CreateIndex
CREATE INDEX "satisfaction_surveys_ticket_id_idx" ON "satisfaction_surveys"("ticket_id");

-- CreateIndex
CREATE INDEX "satisfaction_surveys_conversation_id_idx" ON "satisfaction_surveys"("conversation_id");

-- AddForeignKey
ALTER TABLE "satisfaction_survey_configs" ADD CONSTRAINT "satisfaction_survey_configs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "satisfaction_surveys" ADD CONSTRAINT "satisfaction_surveys_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "satisfaction_surveys" ADD CONSTRAINT "satisfaction_surveys_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "satisfaction_survey_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
