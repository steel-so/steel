-- CreateEnum
CREATE TYPE "SteelAgentVersionStatus" AS ENUM ('PENDING_EVAL', 'REJECTED', 'PUBLISHED', 'CHALLENGER', 'SUPERSEDED', 'DISCARDED');

-- AlterEnum
ALTER TYPE "AiEvalTarget" ADD VALUE 'STEEL_AGENT';

-- AlterTable
ALTER TABLE "ai_eval_runs" ADD COLUMN     "agent_version_id" TEXT;

-- AlterTable
ALTER TABLE "steel_agent_runs" ADD COLUMN     "version_id" TEXT;

-- AlterTable
ALTER TABLE "steel_agents" ADD COLUMN     "challenger_version_id" TEXT,
ADD COLUMN     "eval_min_pass_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
ADD COLUMN     "eval_set_id" TEXT,
ADD COLUMN     "published_version_id" TEXT;

-- CreateTable
CREATE TABLE "steel_agent_versions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "SteelAgentVersionStatus" NOT NULL,
    "instructions" TEXT NOT NULL,
    "max_tool_rounds" INTEGER NOT NULL,
    "tools" JSONB NOT NULL,
    "change_note" TEXT,
    "rollout_percent" INTEGER,
    "eval_run_id" TEXT,
    "eval_passed" INTEGER,
    "eval_total" INTEGER,
    "eval_note" TEXT,
    "created_by_id" TEXT,
    "published_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "steel_agent_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "steel_agent_versions_agent_id_status_idx" ON "steel_agent_versions"("agent_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "steel_agent_versions_agent_id_number_key" ON "steel_agent_versions"("agent_id", "number");

-- CreateIndex
CREATE INDEX "steel_agent_runs_agent_id_version_id_idx" ON "steel_agent_runs"("agent_id", "version_id");

-- AddForeignKey
ALTER TABLE "steel_agent_versions" ADD CONSTRAINT "steel_agent_versions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "steel_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
