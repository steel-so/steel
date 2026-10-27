-- CreateEnum
CREATE TYPE "WhatsAppArchiveKind" AS ENUM ('WEEKLY', 'MONTHLY_FULL');

-- CreateEnum
CREATE TYPE "WhatsAppArchiveStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "whatsapp_archive_settings" (
    "workspace_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "root_folder_name" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_archive_settings_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "whatsapp_archives" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "kind" "WhatsAppArchiveKind" NOT NULL,
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3) NOT NULL,
    "status" "WhatsAppArchiveStatus" NOT NULL DEFAULT 'QUEUED',
    "object_key" TEXT,
    "size_bytes" BIGINT,
    "sha256" TEXT,
    "file_count" INTEGER NOT NULL DEFAULT 0,
    "atendimento_count" INTEGER NOT NULL DEFAULT 0,
    "root_folder_name" TEXT,
    "offsite_key" TEXT,
    "offsite_copied_at" TIMESTAMP(3),
    "error" TEXT,
    "triggered_by_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_archives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_archive_settings_enabled_idx" ON "whatsapp_archive_settings"("enabled");

-- CreateIndex
CREATE INDEX "whatsapp_archives_workspace_id_created_at_idx" ON "whatsapp_archives"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_archives_workspace_id_kind_period_end_idx" ON "whatsapp_archives"("workspace_id", "kind", "period_end");

-- CreateIndex
CREATE INDEX "whatsapp_archives_status_expires_at_idx" ON "whatsapp_archives"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "whatsapp_archive_settings" ADD CONSTRAINT "whatsapp_archive_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_archives" ADD CONSTRAINT "whatsapp_archives_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_archives" ADD CONSTRAINT "whatsapp_archives_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
