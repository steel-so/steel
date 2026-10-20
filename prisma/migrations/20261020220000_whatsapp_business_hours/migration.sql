-- AlterTable
ALTER TABLE "whatsapp_settings" ADD COLUMN     "business_hours_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
ADD COLUMN     "business_hours_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "business_hours_end" VARCHAR(5) NOT NULL DEFAULT '18:00',
ADD COLUMN     "business_hours_start" VARCHAR(5) NOT NULL DEFAULT '08:00';

