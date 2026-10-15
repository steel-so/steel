-- CreateEnum
CREATE TYPE "CrmEmailTemplateVersionReason" AS ENUM ('SAVE', 'TEST_SEND', 'CAMPAIGN', 'RESTORE');

-- CreateTable
CREATE TABLE "crm_email_template_versions" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "reason" "CrmEmailTemplateVersionReason" NOT NULL,
    "label" TEXT,
    "subject" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "restored_from_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_email_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_email_saved_blocks" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fragment" JSONB NOT NULL,
    "node_count" INTEGER NOT NULL,
    "thumbnail" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_email_saved_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_email_template_versions_template_id_created_at_idx" ON "crm_email_template_versions"("template_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_email_saved_blocks_workspace_id_created_at_idx" ON "crm_email_saved_blocks"("workspace_id", "created_at");

-- AddForeignKey
ALTER TABLE "crm_email_template_versions" ADD CONSTRAINT "crm_email_template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "crm_email_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_email_template_versions" ADD CONSTRAINT "crm_email_template_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_email_saved_blocks" ADD CONSTRAINT "crm_email_saved_blocks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_email_saved_blocks" ADD CONSTRAINT "crm_email_saved_blocks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
