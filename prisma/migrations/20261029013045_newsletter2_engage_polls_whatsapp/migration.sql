-- CreateTable
CREATE TABLE "crm_newsletter_polls" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "block_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "show_results" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_newsletter_polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_newsletter_poll_votes" (
    "id" TEXT NOT NULL,
    "poll_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "subscriber_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "person_id" TEXT,
    "option_index" INTEGER NOT NULL,
    "voted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_newsletter_poll_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_newsletter_issue_whatsapp" (
    "issue_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "connection_id" TEXT,
    "template_id" TEXT,
    "variables" JSONB,
    "text" TEXT,
    "legal_basis" "CrmCampaignLegalBasis",
    "consent_confirmed_at" TIMESTAMP(3),
    "consent_confirmed_by_id" TEXT,
    "started_at" TIMESTAMP(3),
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_newsletter_issue_whatsapp_pkey" PRIMARY KEY ("issue_id")
);

-- CreateTable
CREATE TABLE "crm_newsletter_whatsapp_recipients" (
    "id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "subscriber_id" TEXT NOT NULL,
    "person_id" TEXT,
    "name" TEXT NOT NULL,
    "wa_id" TEXT NOT NULL,
    "status" "CrmNewsletterDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "skip_reason" TEXT,
    "provider_message_id" TEXT,
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_newsletter_whatsapp_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_newsletter_polls_issue_id_block_id_key" ON "crm_newsletter_polls"("issue_id", "block_id");

-- CreateIndex
CREATE INDEX "crm_newsletter_poll_votes_poll_id_option_index_idx" ON "crm_newsletter_poll_votes"("poll_id", "option_index");

-- CreateIndex
CREATE UNIQUE INDEX "crm_newsletter_poll_votes_poll_id_recipient_id_key" ON "crm_newsletter_poll_votes"("poll_id", "recipient_id");

-- CreateIndex
CREATE INDEX "crm_newsletter_whatsapp_recipients_issue_id_status_idx" ON "crm_newsletter_whatsapp_recipients"("issue_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "crm_newsletter_whatsapp_recipients_issue_id_wa_id_key" ON "crm_newsletter_whatsapp_recipients"("issue_id", "wa_id");

-- AddForeignKey
ALTER TABLE "crm_newsletter_polls" ADD CONSTRAINT "crm_newsletter_polls_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "crm_newsletter_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_poll_votes" ADD CONSTRAINT "crm_newsletter_poll_votes_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "crm_newsletter_polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_poll_votes" ADD CONSTRAINT "crm_newsletter_poll_votes_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "crm_newsletter_issue_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_issue_whatsapp" ADD CONSTRAINT "crm_newsletter_issue_whatsapp_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "crm_newsletter_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_whatsapp_recipients" ADD CONSTRAINT "crm_newsletter_whatsapp_recipients_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "crm_newsletter_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_whatsapp_recipients" ADD CONSTRAINT "crm_newsletter_whatsapp_recipients_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "crm_newsletter_subscribers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
