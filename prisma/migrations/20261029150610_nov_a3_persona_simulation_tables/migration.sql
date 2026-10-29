-- CreateEnum
CREATE TYPE "SteelAgentSimulationStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SteelAgentSimulationCaseStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "SteelAgentSimulationVerdict" AS ENUM ('PASS', 'FAIL');

-- CreateTable
CREATE TABLE "steel_agent_simulations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SteelAgentSimulationStatus" NOT NULL DEFAULT 'QUEUED',
    "started_by_id" TEXT,
    "pass_score" INTEGER NOT NULL DEFAULT 70,
    "total_cases" INTEGER NOT NULL DEFAULT 0,
    "passed_cases" INTEGER NOT NULL DEFAULT 0,
    "failed_cases" INTEGER NOT NULL DEFAULT 0,
    "avg_score" INTEGER,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "model_key" TEXT,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "steel_agent_simulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "steel_agent_simulation_cases" (
    "id" TEXT NOT NULL,
    "simulation_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "persona_key" TEXT,
    "persona" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "opening_message" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "max_turns" INTEGER NOT NULL DEFAULT 6,
    "status" "SteelAgentSimulationCaseStatus" NOT NULL DEFAULT 'QUEUED',
    "verdict" "SteelAgentSimulationVerdict",
    "score" INTEGER,
    "transcript" JSONB,
    "tool_events" JSONB,
    "criteria_results" JSONB,
    "judge_summary" TEXT,
    "end_reason" TEXT,
    "error" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "steel_agent_simulation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "steel_agent_simulations_agent_id_created_at_idx" ON "steel_agent_simulations"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "steel_agent_simulations_workspace_id_status_idx" ON "steel_agent_simulations"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "steel_agent_simulation_cases_simulation_id_position_idx" ON "steel_agent_simulation_cases"("simulation_id", "position");

-- AddForeignKey
ALTER TABLE "steel_agent_simulations" ADD CONSTRAINT "steel_agent_simulations_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "steel_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steel_agent_simulation_cases" ADD CONSTRAINT "steel_agent_simulation_cases_simulation_id_fkey" FOREIGN KEY ("simulation_id") REFERENCES "steel_agent_simulations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
