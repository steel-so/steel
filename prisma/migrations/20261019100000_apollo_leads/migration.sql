-- CreateEnum
CREATE TYPE "crm_apollo_import_status" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'PAUSED_RATE_LIMIT');

-- CreateEnum
CREATE TYPE "crm_apollo_import_source" AS ENUM ('SEARCH', 'LIST');

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'CRM_APOLLO_IMPORT_DONE';

-- AlterEnum
ALTER TYPE "workspace_integration_kind" ADD VALUE 'APOLLO';

-- AlterTable
ALTER TABLE "crm_leads" ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "external_source" TEXT;

-- CreateTable
CREATE TABLE "crm_apollo_imports" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "status" "crm_apollo_import_status" NOT NULL DEFAULT 'QUEUED',
    "source" "crm_apollo_import_source" NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "apollo_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contacts" JSONB,
    "mailing_list_id" TEXT,
    "requested_count" INTEGER NOT NULL DEFAULT 0,
    "created_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "credits_consumed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_apollo_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_apollo_imports_workspace_id_created_at_idx" ON "crm_apollo_imports"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_apollo_imports_status_idx" ON "crm_apollo_imports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "crm_leads_workspace_id_external_source_external_id_key" ON "crm_leads"("workspace_id", "external_source", "external_id");

-- AddForeignKey
ALTER TABLE "crm_apollo_imports" ADD CONSTRAINT "crm_apollo_imports_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_apollo_imports" ADD CONSTRAINT "crm_apollo_imports_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
