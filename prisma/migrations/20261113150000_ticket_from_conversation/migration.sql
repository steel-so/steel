-- AlterTable
ALTER TABLE "sd_tickets" ADD COLUMN "crm_lead_id" TEXT,
ADD COLUMN "crm_person_id" TEXT,
ADD COLUMN "crm_opportunity_id" TEXT;

-- CreateIndex
CREATE INDEX "sd_tickets_crm_lead_id_idx" ON "sd_tickets"("crm_lead_id");

-- CreateIndex
CREATE INDEX "sd_tickets_crm_person_id_idx" ON "sd_tickets"("crm_person_id");

-- CreateIndex
CREATE INDEX "sd_tickets_crm_opportunity_id_idx" ON "sd_tickets"("crm_opportunity_id");

-- AddForeignKey
ALTER TABLE "sd_tickets" ADD CONSTRAINT "sd_tickets_crm_lead_id_fkey" FOREIGN KEY ("crm_lead_id") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_tickets" ADD CONSTRAINT "sd_tickets_crm_person_id_fkey" FOREIGN KEY ("crm_person_id") REFERENCES "crm_people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_tickets" ADD CONSTRAINT "sd_tickets_crm_opportunity_id_fkey" FOREIGN KEY ("crm_opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
