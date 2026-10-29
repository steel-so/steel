-- AlterTable
ALTER TABLE "whatsapp_settings" ADD COLUMN     "marketing_lite_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "marketing_lite_cloud_fallback" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "whatsapp_broadcast_recipients" ADD COLUMN     "via_marketing_lite" BOOLEAN NOT NULL DEFAULT false;
