-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'WHATSAPP_AI_UNAVAILABLE';

-- AlterEnum
ALTER TYPE "WhatsAppConversationEventKind" ADD VALUE IF NOT EXISTS 'AI_UNAVAILABLE';

-- AlterEnum
ALTER TYPE "WhatsAppConversationEventSource" ADD VALUE IF NOT EXISTS 'AI_REPLY';

-- AlterEnum
ALTER TYPE "CrmRetentionSource" ADD VALUE IF NOT EXISTS 'SLA_BREACH';

-- AlterTable
ALTER TABLE "crm_retention_settings" ADD COLUMN IF NOT EXISTS "on_sla_breach" BOOLEAN NOT NULL DEFAULT false;
