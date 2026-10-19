-- CreateEnum
CREATE TYPE "WhatsAppPhoneCallAiStatus" AS ENUM ('NONE', 'PENDING', 'PROCESSING', 'DONE', 'SKIPPED', 'FAILED');

-- AlterEnum
ALTER TYPE "AiUsageFeature" ADD VALUE 'PHONE_CALL_AI';

-- AlterTable
ALTER TABLE "whatsapp_phone_calls" ADD COLUMN     "ai_model" VARCHAR(80),
ADD COLUMN     "ai_processed_at" TIMESTAMP(3),
ADD COLUMN     "ai_skip_reason" VARCHAR(60),
ADD COLUMN     "ai_status" "WhatsAppPhoneCallAiStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "crm_opportunity_id" TEXT,
ADD COLUMN     "crm_person_id" TEXT,
ADD COLUMN     "next_steps" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "recorded_at" TIMESTAMP(3),
ADD COLUMN     "recording_expires_at" TIMESTAMP(3),
ADD COLUMN     "recording_key" VARCHAR(255),
ADD COLUMN     "recording_mime_type" VARCHAR(40),
ADD COLUMN     "recording_notice" VARCHAR(500),
ADD COLUMN     "recording_requested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recording_size_bytes" INTEGER,
ADD COLUMN     "sd_ticket_id" TEXT,
ADD COLUMN     "sentiment" "WhatsAppSentiment",
ADD COLUMN     "sentiment_score" DOUBLE PRECISION,
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "transcript" TEXT;

-- AlterTable
ALTER TABLE "whatsapp_settings" ADD COLUMN     "call_recording_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "call_recording_notice" VARCHAR(500),
ADD COLUMN     "call_recording_retention_days" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "call_transcription_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "whatsapp_phone_calls_sd_ticket_id_idx" ON "whatsapp_phone_calls"("sd_ticket_id");

-- CreateIndex
CREATE INDEX "whatsapp_phone_calls_crm_person_id_idx" ON "whatsapp_phone_calls"("crm_person_id");

-- CreateIndex
CREATE INDEX "whatsapp_phone_calls_crm_opportunity_id_idx" ON "whatsapp_phone_calls"("crm_opportunity_id");

-- CreateIndex
CREATE INDEX "whatsapp_phone_calls_recording_expires_at_idx" ON "whatsapp_phone_calls"("recording_expires_at");

-- AddForeignKey
ALTER TABLE "whatsapp_phone_calls" ADD CONSTRAINT "whatsapp_phone_calls_sd_ticket_id_fkey" FOREIGN KEY ("sd_ticket_id") REFERENCES "sd_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_phone_calls" ADD CONSTRAINT "whatsapp_phone_calls_crm_person_id_fkey" FOREIGN KEY ("crm_person_id") REFERENCES "crm_people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_phone_calls" ADD CONSTRAINT "whatsapp_phone_calls_crm_opportunity_id_fkey" FOREIGN KEY ("crm_opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
