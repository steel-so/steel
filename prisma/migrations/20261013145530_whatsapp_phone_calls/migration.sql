-- CreateEnum
CREATE TYPE "WhatsAppPhoneCallStatus" AS ENUM ('QUEUED', 'DIALING', 'IN_PROGRESS', 'COMPLETED', 'BUSY', 'NO_ANSWER', 'CANCELED', 'EXTENSION_NO_ANSWER', 'FAILED');

-- CreateTable
CREATE TABLE "whatsapp_phone_calls" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT,
    "device_id" VARCHAR(20) NOT NULL,
    "extension" VARCHAR(20) NOT NULL,
    "destination" VARCHAR(20) NOT NULL,
    "job" VARCHAR(80),
    "callback_token_hash" CHAR(64) NOT NULL,
    "status" "WhatsAppPhoneCallStatus" NOT NULL DEFAULT 'QUEUED',
    "dial_status" VARCHAR(20),
    "answered_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "duration_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_phone_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_phone_calls_callback_token_hash_key" ON "whatsapp_phone_calls"("callback_token_hash");

-- CreateIndex
CREATE INDEX "whatsapp_phone_calls_conversation_id_created_at_idx" ON "whatsapp_phone_calls"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_phone_calls_workspace_id_idx" ON "whatsapp_phone_calls"("workspace_id");

-- AddForeignKey
ALTER TABLE "whatsapp_phone_calls" ADD CONSTRAINT "whatsapp_phone_calls_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_phone_calls" ADD CONSTRAINT "whatsapp_phone_calls_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_phone_calls" ADD CONSTRAINT "whatsapp_phone_calls_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
