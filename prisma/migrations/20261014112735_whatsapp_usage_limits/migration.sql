-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'WHATSAPP_USAGE_WARNING';
ALTER TYPE "NotificationKind" ADD VALUE 'WHATSAPP_USAGE_LIMIT_REACHED';

-- AlterTable
ALTER TABLE "whatsapp_settings" ADD COLUMN     "monthly_conversation_limit" INTEGER,
ADD COLUMN     "monthly_message_limit" INTEGER;

-- CreateTable
CREATE TABLE "whatsapp_usage_monthly" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "conversations" INTEGER NOT NULL DEFAULT 0,
    "outbound_messages" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_usage_monthly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_usage_monthly_workspace_id_period_key" ON "whatsapp_usage_monthly"("workspace_id", "period");

-- AddForeignKey
ALTER TABLE "whatsapp_usage_monthly" ADD CONSTRAINT "whatsapp_usage_monthly_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
