-- AlterEnum
ALTER TYPE "AiActionSource" ADD VALUE 'WHATSAPP';

-- CreateEnum
CREATE TYPE "AiActionConnectorKind" AS ENUM ('LOOKUP', 'ACTION');

-- CreateEnum
CREATE TYPE "AiActionExecutionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILURE');

-- CreateTable
CREATE TABLE "ai_action_connectors" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "AiActionConnectorKind" NOT NULL,
    "method" TEXT NOT NULL,
    "url_template" TEXT NOT NULL,
    "encrypted_headers" TEXT,
    "params" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_action_connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_action_settings" (
    "workspace_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "zap_tools" JSONB NOT NULL DEFAULT '[]',
    "zap_actor_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_action_settings_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "ai_action_executions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "connector_key" TEXT NOT NULL,
    "status" "AiActionExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "http_status" INTEGER,
    "response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_action_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_action_connectors_workspace_id_idx" ON "ai_action_connectors"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_action_connectors_workspace_id_key_key" ON "ai_action_connectors"("workspace_id", "key");

-- CreateIndex
CREATE INDEX "ai_action_executions_created_at_idx" ON "ai_action_executions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_action_executions_workspace_id_idempotency_key_key" ON "ai_action_executions"("workspace_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "ai_action_connectors" ADD CONSTRAINT "ai_action_connectors_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_action_settings" ADD CONSTRAINT "ai_action_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_action_executions" ADD CONSTRAINT "ai_action_executions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
