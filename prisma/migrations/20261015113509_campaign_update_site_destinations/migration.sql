-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CrmCampaignConversionKind" ADD VALUE 'SITE_VIEW';
ALTER TYPE "CrmCampaignConversionKind" ADD VALUE 'SITE_FORM_SUBMISSION';

-- AlterEnum
ALTER TYPE "CrmCampaignDestinationType" ADD VALUE 'SITE_PAGE';

-- AlterTable
ALTER TABLE "crm_campaign_conversions" ADD COLUMN     "form_id" TEXT,
ADD COLUMN     "site_id" TEXT,
ADD COLUMN     "site_page_id" TEXT;

-- AlterTable
ALTER TABLE "crm_campaigns" ADD COLUMN     "site_id" TEXT,
ADD COLUMN     "site_page_id" TEXT,
ADD COLUMN     "whatsapp_quick_reply_id" TEXT;

-- CreateIndex
CREATE INDEX "crm_campaign_conversions_site_id_created_at_idx" ON "crm_campaign_conversions"("site_id", "created_at");
