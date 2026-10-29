-- newsletter2 nl2-digest-ai (ADR 0054 phase 2): automatic digest, subject A/B test, digest notices.

-- CreateEnum
CREATE TYPE "CrmNewsletterAbMetric" AS ENUM ('OPENS', 'CLICKS');

-- CreateEnum
CREATE TYPE "CrmNewsletterDigestCadence" AS ENUM ('WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "CrmNewsletterDigestMode" AS ENUM ('DRAFT', 'AUTO_SEND');

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'CRM_NEWSLETTER_DIGEST_READY';
ALTER TYPE "NotificationKind" ADD VALUE 'CRM_NEWSLETTER_DIGEST_SKIPPED';

-- AlterTable
ALTER TABLE "crm_newsletter_issue_recipients" ADD COLUMN     "ab_held" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ab_variant" TEXT;

-- AlterTable
ALTER TABLE "crm_newsletter_issues" ADD COLUMN     "ab_decided_at" TIMESTAMP(3),
ADD COLUMN     "ab_metric" "CrmNewsletterAbMetric",
ADD COLUMN     "ab_subject_b" TEXT,
ADD COLUMN     "ab_test_percent" INTEGER,
ADD COLUMN     "ab_wait_hours" INTEGER,
ADD COLUMN     "ab_winner" TEXT,
ADD COLUMN     "digest_id" TEXT;

-- CreateTable
CREATE TABLE "crm_newsletter_digests" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "newsletter_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "site_id" TEXT,
    "rss_url" TEXT,
    "cadence" "CrmNewsletterDigestCadence" NOT NULL DEFAULT 'WEEKLY',
    "weekday" INTEGER,
    "month_day" INTEGER,
    "hour" INTEGER NOT NULL DEFAULT 9,
    "mode" "CrmNewsletterDigestMode" NOT NULL DEFAULT 'DRAFT',
    "max_items" INTEGER NOT NULL DEFAULT 5,
    "subject" TEXT NOT NULL,
    "intro" TEXT,
    "next_run_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_item_at" TIMESTAMP(3),
    "last_issue_id" TEXT,
    "last_outcome" TEXT,
    "last_message" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_newsletter_digests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_newsletter_digests_newsletter_id_key" ON "crm_newsletter_digests"("newsletter_id");

-- CreateIndex
CREATE INDEX "crm_newsletter_digests_enabled_next_run_at_idx" ON "crm_newsletter_digests"("enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "crm_newsletter_digests_workspace_id_idx" ON "crm_newsletter_digests"("workspace_id");

-- AddForeignKey
ALTER TABLE "crm_newsletter_issues" ADD CONSTRAINT "crm_newsletter_issues_digest_id_fkey" FOREIGN KEY ("digest_id") REFERENCES "crm_newsletter_digests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_digests" ADD CONSTRAINT "crm_newsletter_digests_newsletter_id_fkey" FOREIGN KEY ("newsletter_id") REFERENCES "crm_newsletters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_digests" ADD CONSTRAINT "crm_newsletter_digests_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
