-- CreateEnum
CREATE TYPE "VoiceAgentRouteKind" AS ENUM ('QUEUE', 'DID');

-- AlterEnum
ALTER TYPE "AiActionSource" ADD VALUE 'VOICE';

-- AlterEnum
ALTER TYPE "AiUsageFeature" ADD VALUE 'VOICE_AGENT';

-- AlterTable
ALTER TABLE "whatsapp_phone_calls" ADD COLUMN     "voice_agent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "voice_end_reason" VARCHAR(40),
ADD COLUMN     "voice_handoff" VARCHAR(2000),
ADD COLUMN     "voice_transfer_target" VARCHAR(40);

-- CreateTable
CREATE TABLE "voice_agent_settings" (
    "workspace_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "notice_text" VARCHAR(500),
    "instructions" VARCHAR(2000),
    "voice" VARCHAR(20) NOT NULL DEFAULT 'alloy',
    "max_call_seconds" INTEGER NOT NULL DEFAULT 300,
    "monthly_minutes_cap" INTEGER NOT NULL DEFAULT 300,
    "silence_timeout_seconds" INTEGER NOT NULL DEFAULT 20,
    "run_as_user_id" TEXT,
    "can_open_tickets" BOOLEAN NOT NULL DEFAULT true,
    "can_lookup_tickets" BOOLEAN NOT NULL DEFAULT true,
    "fallback_target" VARCHAR(40),
    "pabx_secret_hash" CHAR(64),
    "pabx_secret_hint" VARCHAR(8),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_agent_settings_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "voice_agent_routes" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "kind" "VoiceAgentRouteKind" NOT NULL,
    "value" VARCHAR(40) NOT NULL,
    "label" VARCHAR(80),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "transfer_target" VARCHAR(40),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_agent_routes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voice_agent_routes_workspace_id_idx" ON "voice_agent_routes"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "voice_agent_routes_workspace_id_kind_value_key" ON "voice_agent_routes"("workspace_id", "kind", "value");

-- AddForeignKey
ALTER TABLE "voice_agent_settings" ADD CONSTRAINT "voice_agent_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_agent_settings" ADD CONSTRAINT "voice_agent_settings_run_as_user_id_fkey" FOREIGN KEY ("run_as_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_agent_routes" ADD CONSTRAINT "voice_agent_routes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
