-- AlterTable
ALTER TABLE "whatsapp_conversations" ADD COLUMN "last_inbound_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "whatsapp_messages" ADD COLUMN "failure_reason" TEXT;

-- Backfill: the last message received from the contact drives the 24h window.
UPDATE "whatsapp_conversations" AS c
SET "last_inbound_at" = m."last_in"
FROM (
    SELECT "conversation_id", MAX("created_at") AS "last_in"
    FROM "whatsapp_messages"
    WHERE "direction" = 'IN'
    GROUP BY "conversation_id"
) AS m
WHERE m."conversation_id" = c."id";
