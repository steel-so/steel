-- AlterEnum
ALTER TYPE "SteelAgentRunStepKind" ADD VALUE 'PROCEDURE';

-- CreateEnum
CREATE TYPE "AiProcedureStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AiProcedureRunSubject" AS ENUM ('WHATSAPP_CONVERSATION', 'STEEL_AGENT_RUN', 'TEST');

-- CreateEnum
CREATE TYPE "AiProcedureRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'HANDED_OFF', 'CANCELED');

-- CreateEnum
CREATE TYPE "AiProcedureRunStepStatus" AS ENUM ('OK', 'FAILED', 'SKIPPED', 'REJECTED');

-- CreateTable
CREATE TABLE "ai_procedures" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "when_to_use" TEXT NOT NULL,
    "status" "AiProcedureStatus" NOT NULL DEFAULT 'DRAFT',
    "steps" JSONB NOT NULL,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "handoff_message" TEXT,
    "whatsapp_enabled" BOOLEAN NOT NULL DEFAULT true,
    "agent_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "owner_id" TEXT,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_procedures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_procedure_versions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "procedure_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "when_to_use" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "max_attempts" INTEGER NOT NULL,
    "handoff_message" TEXT,
    "change_note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_procedure_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_procedure_runs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "procedure_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "subject_type" "AiProcedureRunSubject" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "status" "AiProcedureRunStatus" NOT NULL DEFAULT 'RUNNING',
    "state" JSONB NOT NULL,
    "failure_reason" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_procedure_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_procedure_run_steps" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "step_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "AiProcedureRunStepStatus" NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_procedure_run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_procedures_workspace_id_status_idx" ON "ai_procedures"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_procedure_versions_procedure_id_number_key" ON "ai_procedure_versions"("procedure_id", "number");

-- CreateIndex
CREATE INDEX "ai_procedure_runs_subject_type_subject_id_status_idx" ON "ai_procedure_runs"("subject_type", "subject_id", "status");

-- CreateIndex
CREATE INDEX "ai_procedure_runs_procedure_id_started_at_idx" ON "ai_procedure_runs"("procedure_id", "started_at");

-- CreateIndex
CREATE INDEX "ai_procedure_runs_workspace_id_started_at_idx" ON "ai_procedure_runs"("workspace_id", "started_at");

-- CreateIndex
CREATE INDEX "ai_procedure_run_steps_run_id_created_at_idx" ON "ai_procedure_run_steps"("run_id", "created_at");

-- AddForeignKey
ALTER TABLE "ai_procedures" ADD CONSTRAINT "ai_procedures_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_procedure_versions" ADD CONSTRAINT "ai_procedure_versions_procedure_id_fkey" FOREIGN KEY ("procedure_id") REFERENCES "ai_procedures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_procedure_runs" ADD CONSTRAINT "ai_procedure_runs_procedure_id_fkey" FOREIGN KEY ("procedure_id") REFERENCES "ai_procedures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_procedure_run_steps" ADD CONSTRAINT "ai_procedure_run_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_procedure_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
