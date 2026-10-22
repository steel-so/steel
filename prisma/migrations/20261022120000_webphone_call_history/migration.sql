-- CreateEnum
CREATE TYPE "WhatsAppPhoneCallDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "WhatsAppPhoneCallSource" AS ENUM ('CLICK_TO_CALL', 'WEBPHONE');

-- AlterTable
ALTER TABLE "whatsapp_phone_calls" ADD COLUMN     "direction" "WhatsAppPhoneCallDirection" NOT NULL DEFAULT 'OUTBOUND',
ADD COLUMN     "pabx_unique_id" VARCHAR(40),
ADD COLUMN     "remote_name" VARCHAR(120),
ADD COLUMN     "source" "WhatsAppPhoneCallSource" NOT NULL DEFAULT 'CLICK_TO_CALL',
ALTER COLUMN "conversation_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "whatsapp_phone_calls_workspace_id_extension_created_at_idx" ON "whatsapp_phone_calls"("workspace_id", "extension", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_phone_calls_workspace_id_pabx_unique_id_key" ON "whatsapp_phone_calls"("workspace_id", "pabx_unique_id");

