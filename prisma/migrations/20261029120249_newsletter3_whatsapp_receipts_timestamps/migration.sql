-- AlterTable
ALTER TABLE "crm_newsletter_whatsapp_recipients" ADD COLUMN     "delivered_at" TIMESTAMP(3),
ADD COLUMN     "failed_at" TIMESTAMP(3),
ADD COLUMN     "read_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "crm_newsletter_whatsapp_recipients_provider_message_id_idx" ON "crm_newsletter_whatsapp_recipients"("provider_message_id");
