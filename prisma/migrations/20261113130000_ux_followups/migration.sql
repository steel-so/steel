-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'WHATSAPP_AI_UNAVAILABLE';

-- AlterEnum
ALTER TYPE "WhatsAppConversationEventKind" ADD VALUE IF NOT EXISTS 'AI_UNAVAILABLE';

-- AlterEnum
ALTER TYPE "WhatsAppConversationEventSource" ADD VALUE IF NOT EXISTS 'AI_REPLY';
