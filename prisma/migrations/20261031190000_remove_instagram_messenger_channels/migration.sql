-- Remove the Instagram Direct and Messenger channels (Z5) from the zap inbox.
-- WhatsApp (Cloud API, Z-API, Coexistence) is untouched.

-- Rows that exist only because of these channels. Deleting the connection
-- cascades to its conversations, messages and comment references.
DELETE FROM "whatsapp_connections"
WHERE "channel" IN ('INSTAGRAM', 'MESSENGER');

-- Contacts created from `ig:` / `fb:` identities (cascade to any leftover conversation).
DELETE FROM "whatsapp_contacts"
WHERE "wa_id" LIKE 'ig:%' OR "wa_id" LIKE 'fb:%';

-- DropTable
DROP TABLE IF EXISTS "whatsapp_social_comments";

-- DropIndex
DROP INDEX IF EXISTS "whatsapp_connections_meta_page_id_idx";
DROP INDEX IF EXISTS "whatsapp_connections_meta_instagram_account_id_idx";

-- AlterTable
ALTER TABLE "whatsapp_connections"
  DROP COLUMN IF EXISTS "channel",
  DROP COLUMN IF EXISTS "meta_page_id",
  DROP COLUMN IF EXISTS "meta_instagram_account_id";

ALTER TABLE "whatsapp_meta_channel_settings"
  DROP COLUMN IF EXISTS "instagram_enabled",
  DROP COLUMN IF EXISTS "messenger_enabled",
  DROP COLUMN IF EXISTS "comments_enabled";

-- DropEnum
DROP TYPE IF EXISTS "WhatsAppChannel";
