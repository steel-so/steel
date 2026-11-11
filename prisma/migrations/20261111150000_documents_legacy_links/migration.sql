-- documents docs-migration: deal rooms and lead proposal presentations point
-- at documents (ADR 0063). Legacy proposal ids stay for history.

-- AlterTable
ALTER TABLE "crm_deal_rooms" ADD COLUMN "document_id" TEXT;

-- AlterTable
ALTER TABLE "crm_lead_proposal_presentations" ADD COLUMN "document_id" TEXT,
ALTER COLUMN "proposal_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "crm_deal_rooms_document_id_idx" ON "crm_deal_rooms"("document_id");

-- CreateIndex
CREATE INDEX "crm_lead_proposal_presentations_document_id_idx" ON "crm_lead_proposal_presentations"("document_id");
