-- AlterEnum
ALTER TYPE "CrmCampaignDestinationType" ADD VALUE 'EXTERNAL_URL';

-- AlterTable
ALTER TABLE "crm_campaigns" ADD COLUMN "external_url" TEXT;
