-- CreateTable
CREATE TABLE "whatsapp_ai_media" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "when_to_send" TEXT NOT NULL,
    "media_url" TEXT NOT NULL,
    "media_type" "WhatsAppBroadcastMediaType" NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_ai_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_ai_media_workspace_id_key_key" ON "whatsapp_ai_media"("workspace_id", "key");

-- CreateIndex
CREATE INDEX "whatsapp_ai_media_workspace_id_idx" ON "whatsapp_ai_media"("workspace_id");

-- AddForeignKey
ALTER TABLE "whatsapp_ai_media" ADD CONSTRAINT "whatsapp_ai_media_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
