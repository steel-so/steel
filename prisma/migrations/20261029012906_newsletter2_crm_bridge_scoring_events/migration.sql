-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CrmLeadRuleField" ADD VALUE 'newsletter_subscribed';
ALTER TYPE "CrmLeadRuleField" ADD VALUE 'newsletter_opened';
ALTER TYPE "CrmLeadRuleField" ADD VALUE 'newsletter_clicked';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CrmWorkflowTriggerType" ADD VALUE 'NEWSLETTER_SUBSCRIBED';
ALTER TYPE "CrmWorkflowTriggerType" ADD VALUE 'NEWSLETTER_UNSUBSCRIBED';
ALTER TYPE "CrmWorkflowTriggerType" ADD VALUE 'NEWSLETTER_LINK_CLICKED';
ALTER TYPE "CrmWorkflowTriggerType" ADD VALUE 'NEWSLETTER_ISSUE_OPENED';

-- CreateTable
CREATE TABLE "crm_lead_score_events" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_lead_score_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_lead_score_events_lead_id_idx" ON "crm_lead_score_events"("lead_id");

-- CreateIndex
CREATE INDEX "crm_lead_score_events_workspace_id_idx" ON "crm_lead_score_events"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_lead_score_events_rule_id_lead_id_event_key_key" ON "crm_lead_score_events"("rule_id", "lead_id", "event_key");

-- AddForeignKey
ALTER TABLE "crm_lead_score_events" ADD CONSTRAINT "crm_lead_score_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
