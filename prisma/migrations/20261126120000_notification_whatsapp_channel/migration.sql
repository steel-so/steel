-- AlterTable
ALTER TABLE "notification_delivery_settings"
  ADD COLUMN "whatsapp_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "whatsapp_number" TEXT,
  ADD COLUMN "whatsapp_verified_at" TIMESTAMP(3),
  ADD COLUMN "whatsapp_code_hash" TEXT,
  ADD COLUMN "whatsapp_code_expires_at" TIMESTAMP(3),
  ADD COLUMN "whatsapp_code_attempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN "whatsapp" BOOLEAN;
