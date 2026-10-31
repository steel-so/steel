-- CreateEnum
CREATE TYPE "WhatsAppChannel" AS ENUM ('WHATSAPP', 'INSTAGRAM', 'MESSENGER');

-- CreateEnum
CREATE TYPE "WhatsAppCoexistenceStatus" AS ENUM ('PENDING', 'SYNCING', 'COMPLETED', 'DECLINED', 'FAILED');

-- AlterTable
ALTER TABLE "whatsapp_connections" ADD COLUMN "channel" "WhatsAppChannel" NOT NULL DEFAULT 'WHATSAPP',
ADD COLUMN "meta_page_id" TEXT,
ADD COLUMN "meta_instagram_account_id" TEXT,
ADD COLUMN "coexistence" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "whatsapp_meta_channel_settings" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "instagram_enabled" BOOLEAN NOT NULL DEFAULT false,
    "messenger_enabled" BOOLEAN NOT NULL DEFAULT false,
    "comments_enabled" BOOLEAN NOT NULL DEFAULT false,
    "coexistence_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_meta_channel_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_social_comments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,
    "post_id" TEXT,
    "parent_comment_id" TEXT,
    "permalink" TEXT,
    "replied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_social_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_coexistence_syncs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "status" "WhatsAppCoexistenceStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "contacts_imported" INTEGER NOT NULL DEFAULT 0,
    "messages_imported" INTEGER NOT NULL DEFAULT 0,
    "conversations_touched" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_coexistence_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_connections_meta_page_id_idx" ON "whatsapp_connections"("meta_page_id");

-- CreateIndex
CREATE INDEX "whatsapp_connections_meta_instagram_account_id_idx" ON "whatsapp_connections"("meta_instagram_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_meta_channel_settings_workspace_id_key" ON "whatsapp_meta_channel_settings"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_social_comments_message_id_key" ON "whatsapp_social_comments"("message_id");

-- CreateIndex
CREATE INDEX "whatsapp_social_comments_workspace_id_connection_id_idx" ON "whatsapp_social_comments"("workspace_id", "connection_id");

-- CreateIndex
CREATE INDEX "whatsapp_social_comments_comment_id_idx" ON "whatsapp_social_comments"("comment_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_coexistence_syncs_connection_id_key" ON "whatsapp_coexistence_syncs"("connection_id");

-- CreateIndex
CREATE INDEX "whatsapp_coexistence_syncs_workspace_id_idx" ON "whatsapp_coexistence_syncs"("workspace_id");

-- AddForeignKey
ALTER TABLE "whatsapp_meta_channel_settings" ADD CONSTRAINT "whatsapp_meta_channel_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_social_comments" ADD CONSTRAINT "whatsapp_social_comments_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "whatsapp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_coexistence_syncs" ADD CONSTRAINT "whatsapp_coexistence_syncs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "whatsapp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
