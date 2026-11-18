-- AlterEnum
ALTER TYPE "WhatsAppBroadcastStatus" ADD VALUE 'PAUSED' BEFORE 'DONE';

-- AlterTable
ALTER TABLE "whatsapp_broadcast_lists" ADD COLUMN "paused_reason" TEXT;

-- AlterTable
ALTER TABLE "crm_campaigns" ADD COLUMN "paused_reason" TEXT;

-- AlterTable
ALTER TABLE "crm_newsletter_issue_whatsapp" ADD COLUMN "paused_reason" TEXT;
