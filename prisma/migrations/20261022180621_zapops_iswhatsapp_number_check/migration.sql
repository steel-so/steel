-- CreateEnum
CREATE TYPE "WhatsAppNumberValidationStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "WhatsAppNumberValidationScope" AS ENUM ('CONTACTS', 'BROADCAST', 'AI_CAMPAIGN', 'IMPORT');

-- AlterEnum
ALTER TYPE "WhatsAppBroadcastRecipientStatus" ADD VALUE 'SKIPPED_NO_WHATSAPP';

-- AlterTable
ALTER TABLE "whatsapp_ai_campaigns" ADD COLUMN     "skip_no_whatsapp" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "whatsapp_broadcast_lists" ADD COLUMN     "skip_no_whatsapp" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "whatsapp_contacts" ADD COLUMN     "has_whatsapp" BOOLEAN,
ADD COLUMN     "whatsapp_checked_at" TIMESTAMP(3),
ADD COLUMN     "whatsapp_lid" TEXT;

-- AlterTable
ALTER TABLE "whatsapp_settings" ADD COLUMN     "whatsapp_check_ttl_days" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "whatsapp_number_validations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "requested_by_id" TEXT,
    "scope" "WhatsAppNumberValidationScope" NOT NULL,
    "scope_id" TEXT,
    "status" "WhatsAppNumberValidationStatus" NOT NULL DEFAULT 'QUEUED',
    "contact_ids" TEXT[],
    "force" BOOLEAN NOT NULL DEFAULT false,
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "with_whatsapp" INTEGER NOT NULL DEFAULT 0,
    "without_whatsapp" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "cached" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_number_validations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_number_validations_workspace_id_created_at_idx" ON "whatsapp_number_validations"("workspace_id", "created_at");

-- AddForeignKey
ALTER TABLE "whatsapp_number_validations" ADD CONSTRAINT "whatsapp_number_validations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
