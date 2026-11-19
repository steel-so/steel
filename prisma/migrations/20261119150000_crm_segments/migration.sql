-- CreateEnum
CREATE TYPE "CrmSegmentTarget" AS ENUM ('PERSON', 'LEAD', 'COMPANY');

-- CreateTable
CREATE TABLE "crm_segments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "target" "CrmSegmentTarget" NOT NULL DEFAULT 'PERSON',
    "definition" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_segments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_segments_workspace_id_name_key" ON "crm_segments"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "crm_segments_workspace_id_target_idx" ON "crm_segments"("workspace_id", "target");

-- AddForeignKey
ALTER TABLE "crm_segments" ADD CONSTRAINT "crm_segments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (customers view and segment rules)
CREATE INDEX "crm_opportunities_point_of_contact_id_idx" ON "crm_opportunities"("point_of_contact_id");

-- CreateIndex
CREATE INDEX "crm_campaign_recipients_workspace_id_person_id_idx" ON "crm_campaign_recipients"("workspace_id", "person_id");

-- CreateIndex
CREATE INDEX "crm_campaign_recipients_workspace_id_lead_id_idx" ON "crm_campaign_recipients"("workspace_id", "lead_id");
