-- AlterTable
ALTER TABLE "crm_lead_scoring_rules" ADD COLUMN     "include_welcome" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "crm_newsletter_welcome_link_clicks" (
    "id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "clicked_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_newsletter_welcome_link_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_newsletter_welcome_link_clicks_delivery_id_url_idx" ON "crm_newsletter_welcome_link_clicks"("delivery_id", "url");

-- CreateIndex
CREATE INDEX "crm_newsletter_welcome_link_clicks_step_id_url_idx" ON "crm_newsletter_welcome_link_clicks"("step_id", "url");

-- AddForeignKey
ALTER TABLE "crm_newsletter_welcome_link_clicks" ADD CONSTRAINT "crm_newsletter_welcome_link_clicks_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "crm_newsletter_welcome_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
