-- CreateEnum
CREATE TYPE "CrmDuplicateEntity" AS ENUM ('PERSON', 'COMPANY');

-- CreateEnum
CREATE TYPE "CrmDuplicateStatus" AS ENUM ('PENDING', 'MERGED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "CrmMeetingBookingStatus" AS ENUM ('CONFIRMED', 'CANCELED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'CRM_DUPLICATES_FOUND';
ALTER TYPE "NotificationKind" ADD VALUE 'CRM_MEETING_BOOKED';

-- AlterTable
ALTER TABLE "crm_forms" ADD COLUMN     "booking_page_id" TEXT;

-- CreateTable
CREATE TABLE "crm_duplicate_candidates" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "entity" "CrmDuplicateEntity" NOT NULL,
    "left_id" TEXT NOT NULL,
    "right_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "CrmDuplicateStatus" NOT NULL DEFAULT 'PENDING',
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" TEXT,

    CONSTRAINT "crm_duplicate_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_merge_logs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "entity" "CrmDuplicateEntity" NOT NULL,
    "survivor_id" TEXT NOT NULL,
    "merged_id" TEXT NOT NULL,
    "candidate_id" TEXT,
    "performed_by_id" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undo_until" TIMESTAMP(3) NOT NULL,
    "undone_at" TIMESTAMP(3),
    "undone_by_id" TEXT,

    CONSTRAINT "crm_merge_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_meeting_pages" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "min_notice_minutes" INTEGER NOT NULL DEFAULT 120,
    "max_days_ahead" INTEGER NOT NULL DEFAULT 30,
    "slot_step_minutes" INTEGER NOT NULL DEFAULT 30,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "format" "CrmLeadMeetingFormat" NOT NULL DEFAULT 'ONLINE',
    "location" TEXT,
    "reminder_minutes" INTEGER NOT NULL DEFAULT 60,
    "lead_source" TEXT NOT NULL DEFAULT 'Agendamento de reunião',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "crm_meeting_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_meeting_hosts" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "last_assigned_at" TIMESTAMP(3),

    CONSTRAINT "crm_meeting_hosts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_meeting_availabilities" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "weekly_hours" JSONB NOT NULL DEFAULT '{}',
    "ics_url_enc" TEXT,
    "ics_checked_at" TIMESTAMP(3),
    "ics_last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_meeting_availabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_meeting_bookings" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "host_user_id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" "CrmMeetingBookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "guest_name" TEXT NOT NULL,
    "guest_email" TEXT NOT NULL,
    "guest_phone" TEXT,
    "guest_notes" TEXT,
    "guest_timezone" TEXT NOT NULL,
    "lead_id" TEXT,
    "calendar_event_id" TEXT,
    "manage_token" TEXT NOT NULL,
    "confirmation_sent_at" TIMESTAMP(3),
    "reminder_sent_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "canceled_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_meeting_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_duplicate_candidates_workspace_id_entity_status_score_idx" ON "crm_duplicate_candidates"("workspace_id", "entity", "status", "score");

-- CreateIndex
CREATE UNIQUE INDEX "crm_duplicate_candidates_workspace_id_entity_left_id_right__key" ON "crm_duplicate_candidates"("workspace_id", "entity", "left_id", "right_id");

-- CreateIndex
CREATE INDEX "crm_merge_logs_workspace_id_created_at_idx" ON "crm_merge_logs"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_merge_logs_survivor_id_idx" ON "crm_merge_logs"("survivor_id");

-- CreateIndex
CREATE INDEX "crm_merge_logs_merged_id_idx" ON "crm_merge_logs"("merged_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_meeting_pages_slug_key" ON "crm_meeting_pages"("slug");

-- CreateIndex
CREATE INDEX "crm_meeting_pages_workspace_id_deleted_at_idx" ON "crm_meeting_pages"("workspace_id", "deleted_at");

-- CreateIndex
CREATE INDEX "crm_meeting_hosts_user_id_idx" ON "crm_meeting_hosts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_meeting_hosts_page_id_user_id_key" ON "crm_meeting_hosts"("page_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_meeting_availabilities_workspace_id_user_id_key" ON "crm_meeting_availabilities"("workspace_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_meeting_bookings_manage_token_key" ON "crm_meeting_bookings"("manage_token");

-- CreateIndex
CREATE INDEX "crm_meeting_bookings_host_user_id_starts_at_idx" ON "crm_meeting_bookings"("host_user_id", "starts_at");

-- CreateIndex
CREATE INDEX "crm_meeting_bookings_workspace_id_starts_at_idx" ON "crm_meeting_bookings"("workspace_id", "starts_at");

-- CreateIndex
CREATE INDEX "crm_meeting_bookings_page_id_idx" ON "crm_meeting_bookings"("page_id");

-- CreateIndex
CREATE INDEX "crm_meeting_bookings_status_starts_at_idx" ON "crm_meeting_bookings"("status", "starts_at");

-- AddForeignKey
ALTER TABLE "crm_duplicate_candidates" ADD CONSTRAINT "crm_duplicate_candidates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_merge_logs" ADD CONSTRAINT "crm_merge_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_meeting_pages" ADD CONSTRAINT "crm_meeting_pages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_meeting_hosts" ADD CONSTRAINT "crm_meeting_hosts_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "crm_meeting_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_meeting_availabilities" ADD CONSTRAINT "crm_meeting_availabilities_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_meeting_bookings" ADD CONSTRAINT "crm_meeting_bookings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_meeting_bookings" ADD CONSTRAINT "crm_meeting_bookings_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "crm_meeting_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
