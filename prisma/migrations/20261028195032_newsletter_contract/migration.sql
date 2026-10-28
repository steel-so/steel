-- CreateEnum
CREATE TYPE "WorkspaceSendingDomainStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'FAILED', 'TEMPORARY_FAILURE');

-- CreateEnum
CREATE TYPE "CrmNewsletterStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CrmNewsletterSubscriberStatus" AS ENUM ('PENDING', 'ACTIVE', 'UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED');

-- CreateEnum
CREATE TYPE "CrmNewsletterSubscriberSource" AS ENUM ('FORM', 'SITE', 'PUBLIC_PAGE', 'API', 'IMPORT', 'MANUAL');

-- CreateEnum
CREATE TYPE "CrmNewsletterIssueStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "CrmNewsletterDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'SKIPPED', 'FAILED');

-- AlterEnum
ALTER TYPE "CrmEmailOptOutSource" ADD VALUE 'PREFERENCES';

-- AlterTable
ALTER TABLE "crm_forms" ADD COLUMN     "newsletter_id" TEXT;

-- CreateTable
CREATE TABLE "workspace_sending_domains" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "resend_domain_id" TEXT,
    "status" "WorkspaceSendingDomainStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "records" JSONB NOT NULL DEFAULT '[]',
    "region" TEXT NOT NULL DEFAULT 'sa-east-1',
    "failure_reason" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_sending_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_newsletters" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "cadence_label" TEXT,
    "from_name" TEXT NOT NULL,
    "from_email" TEXT NOT NULL,
    "reply_to" TEXT,
    "sending_domain_id" TEXT,
    "template_id" TEXT,
    "double_opt_in" BOOLEAN NOT NULL DEFAULT true,
    "legal_basis" "CrmCampaignLegalBasis" NOT NULL DEFAULT 'CONSENT',
    "archive_enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "CrmNewsletterStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "crm_newsletters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_newsletter_subscribers" (
    "id" TEXT NOT NULL,
    "newsletter_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "person_id" TEXT,
    "status" "CrmNewsletterSubscriberStatus" NOT NULL DEFAULT 'PENDING',
    "source" "CrmNewsletterSubscriberSource" NOT NULL,
    "source_ref" TEXT,
    "consent_at" TIMESTAMP(3),
    "consent_ip" TEXT,
    "consent_user_agent" TEXT,
    "consent_text" TEXT,
    "confirm_sent_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "unsubscribed_at" TIMESTAMP(3),
    "unsubscribe_reason" TEXT,
    "bounced_at" TIMESTAMP(3),
    "complained_at" TIMESTAMP(3),
    "last_sent_at" TIMESTAMP(3),
    "last_opened_at" TIMESTAMP(3),
    "last_clicked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_newsletter_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_newsletter_issues" (
    "id" TEXT NOT NULL,
    "newsletter_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "number" INTEGER,
    "subject" TEXT NOT NULL,
    "preheader" TEXT,
    "slug" TEXT NOT NULL,
    "builder_document" JSONB NOT NULL DEFAULT '{}',
    "web_html" TEXT,
    "excerpt" TEXT,
    "segment" JSONB NOT NULL DEFAULT '{}',
    "status" "CrmNewsletterIssueStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduled_at" TIMESTAMP(3),
    "sending_started_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "crm_newsletter_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_newsletter_issue_recipients" (
    "id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "subscriber_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" "CrmNewsletterDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "skip_reason" TEXT,
    "provider_message_id" TEXT,
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3),
    "clicked_at" TIMESTAMP(3),
    "bounced_at" TIMESTAMP(3),
    "complained_at" TIMESTAMP(3),
    "unsubscribed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_newsletter_issue_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_newsletter_link_clicks" (
    "id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "clicked_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_newsletter_link_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_newsletter_settings" (
    "workspace_id" TEXT NOT NULL,
    "monthly_email_limit_override" INTEGER,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_newsletter_settings_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "crm_newsletter_usage_monthly" (
    "workspace_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "emails_sent" INTEGER NOT NULL DEFAULT 0,
    "notified_thresholds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_newsletter_usage_monthly_pkey" PRIMARY KEY ("workspace_id","month")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_sending_domains_name_key" ON "workspace_sending_domains"("name");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_sending_domains_resend_domain_id_key" ON "workspace_sending_domains"("resend_domain_id");

-- CreateIndex
CREATE INDEX "workspace_sending_domains_workspace_id_idx" ON "workspace_sending_domains"("workspace_id");

-- CreateIndex
CREATE INDEX "workspace_sending_domains_status_last_checked_at_idx" ON "workspace_sending_domains"("status", "last_checked_at");

-- CreateIndex
CREATE INDEX "crm_newsletters_workspace_id_deleted_at_idx" ON "crm_newsletters"("workspace_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_newsletters_workspace_id_slug_key" ON "crm_newsletters"("workspace_id", "slug");

-- CreateIndex
CREATE INDEX "crm_newsletter_subscribers_newsletter_id_status_idx" ON "crm_newsletter_subscribers"("newsletter_id", "status");

-- CreateIndex
CREATE INDEX "crm_newsletter_subscribers_workspace_id_email_idx" ON "crm_newsletter_subscribers"("workspace_id", "email");

-- CreateIndex
CREATE INDEX "crm_newsletter_subscribers_person_id_idx" ON "crm_newsletter_subscribers"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_newsletter_subscribers_newsletter_id_email_key" ON "crm_newsletter_subscribers"("newsletter_id", "email");

-- CreateIndex
CREATE INDEX "crm_newsletter_issues_workspace_id_deleted_at_idx" ON "crm_newsletter_issues"("workspace_id", "deleted_at");

-- CreateIndex
CREATE INDEX "crm_newsletter_issues_status_scheduled_at_idx" ON "crm_newsletter_issues"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_newsletter_issues_newsletter_id_slug_key" ON "crm_newsletter_issues"("newsletter_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "crm_newsletter_issues_newsletter_id_number_key" ON "crm_newsletter_issues"("newsletter_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "crm_newsletter_issue_recipients_provider_message_id_key" ON "crm_newsletter_issue_recipients"("provider_message_id");

-- CreateIndex
CREATE INDEX "crm_newsletter_issue_recipients_issue_id_status_idx" ON "crm_newsletter_issue_recipients"("issue_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "crm_newsletter_issue_recipients_issue_id_subscriber_id_key" ON "crm_newsletter_issue_recipients"("issue_id", "subscriber_id");

-- CreateIndex
CREATE INDEX "crm_newsletter_link_clicks_issue_id_url_idx" ON "crm_newsletter_link_clicks"("issue_id", "url");

-- CreateIndex
CREATE INDEX "crm_newsletter_link_clicks_recipient_id_idx" ON "crm_newsletter_link_clicks"("recipient_id");

-- AddForeignKey
ALTER TABLE "crm_forms" ADD CONSTRAINT "crm_forms_newsletter_id_fkey" FOREIGN KEY ("newsletter_id") REFERENCES "crm_newsletters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_sending_domains" ADD CONSTRAINT "workspace_sending_domains_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_sending_domains" ADD CONSTRAINT "workspace_sending_domains_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletters" ADD CONSTRAINT "crm_newsletters_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletters" ADD CONSTRAINT "crm_newsletters_sending_domain_id_fkey" FOREIGN KEY ("sending_domain_id") REFERENCES "workspace_sending_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletters" ADD CONSTRAINT "crm_newsletters_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_subscribers" ADD CONSTRAINT "crm_newsletter_subscribers_newsletter_id_fkey" FOREIGN KEY ("newsletter_id") REFERENCES "crm_newsletters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_issues" ADD CONSTRAINT "crm_newsletter_issues_newsletter_id_fkey" FOREIGN KEY ("newsletter_id") REFERENCES "crm_newsletters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_issues" ADD CONSTRAINT "crm_newsletter_issues_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_issue_recipients" ADD CONSTRAINT "crm_newsletter_issue_recipients_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "crm_newsletter_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_issue_recipients" ADD CONSTRAINT "crm_newsletter_issue_recipients_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "crm_newsletter_subscribers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_link_clicks" ADD CONSTRAINT "crm_newsletter_link_clicks_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "crm_newsletter_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_link_clicks" ADD CONSTRAINT "crm_newsletter_link_clicks_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "crm_newsletter_issue_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_settings" ADD CONSTRAINT "crm_newsletter_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_usage_monthly" ADD CONSTRAINT "crm_newsletter_usage_monthly_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
