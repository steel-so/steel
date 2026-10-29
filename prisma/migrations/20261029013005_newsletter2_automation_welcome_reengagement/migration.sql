-- CreateEnum
CREATE TYPE "CrmNewsletterDelayUnit" AS ENUM ('HOURS', 'DAYS');

-- CreateEnum
CREATE TYPE "CrmNewsletterReengagementAction" AS ENUM ('UNSUBSCRIBE', 'FLAG');

-- CreateEnum
CREATE TYPE "CrmNewsletterReengagementStatus" AS ENUM ('SENDING', 'WAITING', 'REENGAGED', 'UNSUBSCRIBED', 'FLAGGED', 'SKIPPED', 'FAILED');

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'CRM_NEWSLETTER_REENGAGEMENT_SUMMARY';

-- CreateTable
CREATE TABLE "crm_newsletter_welcome_steps" (
    "id" TEXT NOT NULL,
    "newsletter_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "delay_value" INTEGER NOT NULL,
    "delay_unit" "CrmNewsletterDelayUnit" NOT NULL DEFAULT 'DAYS',
    "subject" TEXT NOT NULL,
    "preheader" TEXT,
    "builder_document" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_newsletter_welcome_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_newsletter_welcome_deliveries" (
    "id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "newsletter_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "subscriber_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "CrmNewsletterDeliveryStatus" NOT NULL DEFAULT 'SENDING',
    "skip_reason" TEXT,
    "provider_message_id" TEXT,
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3),
    "clicked_at" TIMESTAMP(3),
    "bounced_at" TIMESTAMP(3),
    "complained_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_newsletter_welcome_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_newsletter_reengagement_settings" (
    "newsletter_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "min_issues" INTEGER NOT NULL DEFAULT 3,
    "inactive_days" INTEGER NOT NULL DEFAULT 90,
    "grace_days" INTEGER NOT NULL DEFAULT 30,
    "action" "CrmNewsletterReengagementAction" NOT NULL DEFAULT 'UNSUBSCRIBE',
    "subject" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "button_label" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_newsletter_reengagement_settings_pkey" PRIMARY KEY ("newsletter_id")
);

-- CreateTable
CREATE TABLE "crm_newsletter_reengagements" (
    "id" TEXT NOT NULL,
    "newsletter_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "subscriber_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "cycle" TEXT NOT NULL,
    "status" "CrmNewsletterReengagementStatus" NOT NULL DEFAULT 'SENDING',
    "provider_message_id" TEXT,
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3),
    "clicked_at" TIMESTAMP(3),
    "reengaged_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_newsletter_reengagements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_newsletter_welcome_steps_newsletter_id_position_idx" ON "crm_newsletter_welcome_steps"("newsletter_id", "position");

-- CreateIndex
CREATE INDEX "crm_newsletter_welcome_steps_enabled_idx" ON "crm_newsletter_welcome_steps"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "crm_newsletter_welcome_deliveries_provider_message_id_key" ON "crm_newsletter_welcome_deliveries"("provider_message_id");

-- CreateIndex
CREATE INDEX "crm_newsletter_welcome_deliveries_status_updated_at_idx" ON "crm_newsletter_welcome_deliveries"("status", "updated_at");

-- CreateIndex
CREATE INDEX "crm_newsletter_welcome_deliveries_subscriber_id_idx" ON "crm_newsletter_welcome_deliveries"("subscriber_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_newsletter_welcome_deliveries_step_id_subscriber_id_key" ON "crm_newsletter_welcome_deliveries"("step_id", "subscriber_id");

-- CreateIndex
CREATE INDEX "crm_newsletter_reengagement_settings_enabled_idx" ON "crm_newsletter_reengagement_settings"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "crm_newsletter_reengagements_provider_message_id_key" ON "crm_newsletter_reengagements"("provider_message_id");

-- CreateIndex
CREATE INDEX "crm_newsletter_reengagements_newsletter_id_status_idx" ON "crm_newsletter_reengagements"("newsletter_id", "status");

-- CreateIndex
CREATE INDEX "crm_newsletter_reengagements_status_sent_at_idx" ON "crm_newsletter_reengagements"("status", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_newsletter_reengagements_subscriber_id_cycle_key" ON "crm_newsletter_reengagements"("subscriber_id", "cycle");

-- AddForeignKey
ALTER TABLE "crm_newsletter_welcome_steps" ADD CONSTRAINT "crm_newsletter_welcome_steps_newsletter_id_fkey" FOREIGN KEY ("newsletter_id") REFERENCES "crm_newsletters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_welcome_deliveries" ADD CONSTRAINT "crm_newsletter_welcome_deliveries_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "crm_newsletter_welcome_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_welcome_deliveries" ADD CONSTRAINT "crm_newsletter_welcome_deliveries_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "crm_newsletter_subscribers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_reengagement_settings" ADD CONSTRAINT "crm_newsletter_reengagement_settings_newsletter_id_fkey" FOREIGN KEY ("newsletter_id") REFERENCES "crm_newsletters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_reengagements" ADD CONSTRAINT "crm_newsletter_reengagements_newsletter_id_fkey" FOREIGN KEY ("newsletter_id") REFERENCES "crm_newsletters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_reengagements" ADD CONSTRAINT "crm_newsletter_reengagements_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "crm_newsletter_subscribers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
