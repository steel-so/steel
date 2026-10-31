-- AlterEnum
ALTER TYPE "WhatsAppProvider" ADD VALUE 'WIDGET';

-- CreateTable
CREATE TABLE "whatsapp_widget_settings" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "public_key" TEXT NOT NULL,
    "allowed_origins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "title" VARCHAR(60) NOT NULL DEFAULT 'Fale com a gente',
    "welcome_message" VARCHAR(280) NOT NULL DEFAULT 'Olá! Como podemos ajudar?',
    "accent_color" VARCHAR(7) NOT NULL DEFAULT '#2563eb',
    "position" VARCHAR(5) NOT NULL DEFAULT 'RIGHT',
    "pre_chat_enabled" BOOLEAN NOT NULL DEFAULT false,
    "pre_chat_ask_email" BOOLEAN NOT NULL DEFAULT true,
    "pre_chat_ask_phone" BOOLEAN NOT NULL DEFAULT false,
    "offline_enabled" BOOLEAN NOT NULL DEFAULT true,
    "offline_message" VARCHAR(280) NOT NULL DEFAULT 'No momento estamos fora do horário de atendimento. Deixe sua mensagem que respondemos assim que possível.',
    "team_id" TEXT,
    "connection_id" TEXT,
    "show_portal" BOOLEAN NOT NULL DEFAULT false,
    "show_survey" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_widget_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_widget_visitors" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "name" VARCHAR(120),
    "email" VARCHAR(200),
    "phone" VARCHAR(40),
    "origin" VARCHAR(200),
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_widget_visitors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_widget_settings_workspace_id_key" ON "whatsapp_widget_settings"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_widget_settings_public_key_key" ON "whatsapp_widget_settings"("public_key");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_widget_visitors_token_hash_key" ON "whatsapp_widget_visitors"("token_hash");

-- CreateIndex
CREATE INDEX "whatsapp_widget_visitors_workspace_id_idx" ON "whatsapp_widget_visitors"("workspace_id");

-- CreateIndex
CREATE INDEX "whatsapp_widget_visitors_contact_id_idx" ON "whatsapp_widget_visitors"("contact_id");

-- AddForeignKey
ALTER TABLE "whatsapp_widget_settings" ADD CONSTRAINT "whatsapp_widget_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_widget_visitors" ADD CONSTRAINT "whatsapp_widget_visitors_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_widget_visitors" ADD CONSTRAINT "whatsapp_widget_visitors_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "whatsapp_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
