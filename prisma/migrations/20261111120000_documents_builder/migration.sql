-- documents: CRM > Documentos, document builder on Steel Canvas (ADR 0063).

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('PROPOSAL', 'CONTRACT', 'QUOTE', 'PRESENTATION', 'TERMS', 'REPORT', 'OTHER');
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'ARCHIVED');
CREATE TYPE "DocumentSource" AS ENUM ('BLANK', 'TEMPLATE', 'DUPLICATE', 'PDF_IMPORT', 'AI_PROMPT', 'LEGACY_PROPOSAL');
CREATE TYPE "DocumentRecipientRole" AS ENUM ('VIEWER', 'APPROVER');
CREATE TYPE "DocumentRecipientStatus" AS ENUM ('PENDING', 'VIEWED', 'ACCEPTED', 'DECLINED');
CREATE TYPE "DocumentDeliveryChannel" AS ENUM ('LINK', 'EMAIL', 'WHATSAPP');
CREATE TYPE "DocumentResponseAction" AS ENUM ('ACCEPT', 'DECLINE', 'SUBMIT');
CREATE TYPE "DocumentEventType" AS ENUM ('CREATED', 'SENT', 'OPENED', 'FORWARDED', 'LINK_CLICKED', 'VIDEO_PLAYED', 'ATTACHMENT_DOWNLOADED', 'PDF_DOWNLOADED', 'FIELDS_SUBMITTED', 'ACCEPTED', 'DECLINED', 'PAYMENT_STARTED', 'PAID', 'EXPIRED', 'REOPENED');
CREATE TYPE "DocumentJobStatus" AS ENUM ('PENDING', 'RUNNING', 'READY', 'FAILED');
CREATE TYPE "DocumentImportMode" AS ENUM ('PDF', 'DOCX', 'PROMPT');

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL DEFAULT 'OTHER',
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "is_template" BOOLEAN NOT NULL DEFAULT false,
    "template_id" TEXT,
    "source" "DocumentSource" NOT NULL DEFAULT 'BLANK',
    "content" JSONB NOT NULL,
    "theme" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "current_version_id" TEXT,
    "public_token" TEXT NOT NULL,
    "link_enabled" BOOLEAN NOT NULL DEFAULT true,
    "valid_until" TIMESTAMP(3),
    "total_value" DECIMAL(14,2),
    "sent_at" TIMESTAMP(3),
    "first_viewed_at" TIMESTAMP(3),
    "last_viewed_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "accepted_by_name" TEXT,
    "accepted_by_email" TEXT,
    "declined_at" TIMESTAMP(3),
    "decline_reason" TEXT,
    "expired_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "company_id" TEXT,
    "person_id" TEXT,
    "opportunity_id" TEXT,
    "lead_id" TEXT,
    "owner_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "legacy_proposal_id" TEXT,
    "legacy_template_id" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "theme" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "sha256" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_recipients" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "person_id" TEXT,
    "role" "DocumentRecipientRole" NOT NULL DEFAULT 'APPROVER',
    "status" "DocumentRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "channel" "DocumentDeliveryChannel" NOT NULL DEFAULT 'LINK',
    "token" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3),
    "first_viewed_at" TIMESTAMP(3),
    "last_viewed_at" TIMESTAMP(3),
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_recipients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_responses" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "recipient_id" TEXT,
    "action" "DocumentResponseAction" NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "selection" JSONB NOT NULL DEFAULT '{}',
    "total_value" DECIMAL(14,2),
    "reason" TEXT,
    "version_sha256" TEXT NOT NULL,
    "ip_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_responses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_sessions" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "version_id" TEXT,
    "recipient_id" TEXT,
    "session_key" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "ip_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "device" TEXT,
    "referrer" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "active_ms" INTEGER NOT NULL DEFAULT 0,
    "max_scroll_pct" INTEGER NOT NULL DEFAULT 0,
    "reached_end" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_section_stats" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "active_ms" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_section_stats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_events" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "type" "DocumentEventType" NOT NULL,
    "session_id" TEXT,
    "recipient_id" TEXT,
    "actor_id" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_exports" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "version_id" TEXT,
    "status" "DocumentJobStatus" NOT NULL DEFAULT 'PENDING',
    "storage_key" TEXT,
    "size_bytes" INTEGER,
    "page_count" INTEGER,
    "error" TEXT,
    "requested_by_id" TEXT,
    "recipient_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "document_exports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_imports" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "document_id" TEXT,
    "mode" "DocumentImportMode" NOT NULL,
    "status" "DocumentJobStatus" NOT NULL DEFAULT 'PENDING',
    "kind" "DocumentKind" NOT NULL DEFAULT 'OTHER',
    "file_key" TEXT,
    "file_name" TEXT,
    "file_size" INTEGER,
    "page_count" INTEGER,
    "prompt" TEXT,
    "progress" JSONB NOT NULL DEFAULT '{}',
    "model" TEXT,
    "cost_usd" DECIMAL(10,6),
    "error" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "document_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_current_version_id_key" ON "documents"("current_version_id");
CREATE UNIQUE INDEX "documents_public_token_key" ON "documents"("public_token");
CREATE UNIQUE INDEX "documents_legacy_proposal_id_key" ON "documents"("legacy_proposal_id");
CREATE UNIQUE INDEX "documents_legacy_template_id_key" ON "documents"("legacy_template_id");
CREATE INDEX "documents_workspace_id_is_template_deleted_at_idx" ON "documents"("workspace_id", "is_template", "deleted_at");
CREATE INDEX "documents_workspace_id_kind_idx" ON "documents"("workspace_id", "kind");
CREATE INDEX "documents_workspace_id_status_idx" ON "documents"("workspace_id", "status");
CREATE INDEX "documents_status_valid_until_idx" ON "documents"("status", "valid_until");
CREATE INDEX "documents_template_id_idx" ON "documents"("template_id");
CREATE INDEX "documents_opportunity_id_idx" ON "documents"("opportunity_id");
CREATE INDEX "documents_company_id_idx" ON "documents"("company_id");
CREATE INDEX "documents_person_id_idx" ON "documents"("person_id");
CREATE INDEX "documents_lead_id_idx" ON "documents"("lead_id");

CREATE UNIQUE INDEX "document_versions_document_id_number_key" ON "document_versions"("document_id", "number");
CREATE INDEX "document_versions_workspace_id_idx" ON "document_versions"("workspace_id");

CREATE UNIQUE INDEX "document_recipients_token_key" ON "document_recipients"("token");
CREATE INDEX "document_recipients_document_id_idx" ON "document_recipients"("document_id");
CREATE INDEX "document_recipients_workspace_id_idx" ON "document_recipients"("workspace_id");

CREATE INDEX "document_responses_document_id_created_at_idx" ON "document_responses"("document_id", "created_at");
CREATE INDEX "document_responses_workspace_id_idx" ON "document_responses"("workspace_id");

CREATE UNIQUE INDEX "document_sessions_document_id_session_key_key" ON "document_sessions"("document_id", "session_key");
CREATE INDEX "document_sessions_document_id_started_at_idx" ON "document_sessions"("document_id", "started_at");
CREATE INDEX "document_sessions_workspace_id_idx" ON "document_sessions"("workspace_id");

CREATE UNIQUE INDEX "document_section_stats_session_id_section_id_key" ON "document_section_stats"("session_id", "section_id");
CREATE INDEX "document_section_stats_document_id_section_id_idx" ON "document_section_stats"("document_id", "section_id");

CREATE INDEX "document_events_document_id_created_at_idx" ON "document_events"("document_id", "created_at");
CREATE INDEX "document_events_workspace_id_type_created_at_idx" ON "document_events"("workspace_id", "type", "created_at");

CREATE INDEX "document_exports_document_id_created_at_idx" ON "document_exports"("document_id", "created_at");
CREATE INDEX "document_exports_status_expires_at_idx" ON "document_exports"("status", "expires_at");

CREATE INDEX "document_imports_workspace_id_created_at_idx" ON "document_imports"("workspace_id", "created_at");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "crm_people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_recipients" ADD CONSTRAINT "document_recipients_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_responses" ADD CONSTRAINT "document_responses_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_responses" ADD CONSTRAINT "document_responses_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_responses" ADD CONSTRAINT "document_responses_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "document_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "document_sessions" ADD CONSTRAINT "document_sessions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_sessions" ADD CONSTRAINT "document_sessions_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "document_sessions" ADD CONSTRAINT "document_sessions_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "document_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "document_section_stats" ADD CONSTRAINT "document_section_stats_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "document_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_section_stats" ADD CONSTRAINT "document_section_stats_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_events" ADD CONSTRAINT "document_events_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_events" ADD CONSTRAINT "document_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "document_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "document_events" ADD CONSTRAINT "document_events_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "document_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "document_exports" ADD CONSTRAINT "document_exports_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_exports" ADD CONSTRAINT "document_exports_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "document_imports" ADD CONSTRAINT "document_imports_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_imports" ADD CONSTRAINT "document_imports_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "document_imports" ADD CONSTRAINT "document_imports_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
