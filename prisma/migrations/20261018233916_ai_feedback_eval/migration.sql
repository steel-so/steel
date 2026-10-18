-- CreateEnum
CREATE TYPE "AiFeedbackSurface" AS ENUM ('STEEL_AI_MESSAGE', 'STEEL_AGENT_RUN', 'SD_COPILOT', 'SD_TRIAGE', 'SD_KCS_DRAFT', 'WHATSAPP_AUTO_REPLY');

-- CreateEnum
CREATE TYPE "AiFeedbackRating" AS ENUM ('UP', 'DOWN');

-- CreateEnum
CREATE TYPE "AiEvalTarget" AS ENUM ('STEEL_ASSISTANT', 'WHATSAPP_REPLY');

-- CreateEnum
CREATE TYPE "AiEvalRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- AlterEnum
ALTER TYPE "AiUsageFeature" ADD VALUE 'AI_EVAL';

-- CreateTable
CREATE TABLE "ai_feedback" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "surface" "AiFeedbackSurface" NOT NULL,
    "target_id" TEXT NOT NULL,
    "variant" TEXT NOT NULL DEFAULT '',
    "rating" "AiFeedbackRating" NOT NULL,
    "reason" TEXT,
    "comment" TEXT,
    "model_key" TEXT,
    "module" "ModuleKind",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_eval_sets" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "target" "AiEvalTarget" NOT NULL,
    "skill_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_eval_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_eval_cases" (
    "id" TEXT NOT NULL,
    "set_id" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "expected" TEXT,
    "criteria" TEXT,
    "must_contain" TEXT[],
    "must_not_contain" TEXT[],
    "source_message_id" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_eval_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_eval_runs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "set_id" TEXT NOT NULL,
    "status" "AiEvalRunStatus" NOT NULL DEFAULT 'QUEUED',
    "model_key" TEXT,
    "judge_model_key" TEXT,
    "skill_id" TEXT,
    "prompt_override" TEXT,
    "reason" TEXT NOT NULL DEFAULT 'manual',
    "started_by_id" TEXT,
    "case_count" INTEGER NOT NULL DEFAULT 0,
    "passed_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "avg_score" DOUBLE PRECISION,
    "cost_usd" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_eval_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_eval_results" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "case_id" TEXT,
    "input" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "checks_passed" BOOLEAN NOT NULL,
    "failed_checks" TEXT[],
    "judge_score" DOUBLE PRECISION,
    "judge_passed" BOOLEAN,
    "judge_rationale" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_eval_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_feedback_workspace_id_created_at_idx" ON "ai_feedback"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_feedback_workspace_id_surface_target_id_idx" ON "ai_feedback"("workspace_id", "surface", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_feedback_user_id_surface_target_id_variant_key" ON "ai_feedback"("user_id", "surface", "target_id", "variant");

-- CreateIndex
CREATE INDEX "ai_eval_sets_workspace_id_target_idx" ON "ai_eval_sets"("workspace_id", "target");

-- CreateIndex
CREATE INDEX "ai_eval_cases_set_id_position_idx" ON "ai_eval_cases"("set_id", "position");

-- CreateIndex
CREATE INDEX "ai_eval_runs_set_id_created_at_idx" ON "ai_eval_runs"("set_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_eval_runs_workspace_id_created_at_idx" ON "ai_eval_runs"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_eval_results_run_id_idx" ON "ai_eval_results"("run_id");

-- AddForeignKey
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_eval_sets" ADD CONSTRAINT "ai_eval_sets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_eval_sets" ADD CONSTRAINT "ai_eval_sets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_eval_cases" ADD CONSTRAINT "ai_eval_cases_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "ai_eval_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_eval_runs" ADD CONSTRAINT "ai_eval_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_eval_runs" ADD CONSTRAINT "ai_eval_runs_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "ai_eval_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_eval_runs" ADD CONSTRAINT "ai_eval_runs_started_by_id_fkey" FOREIGN KEY ("started_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_eval_results" ADD CONSTRAINT "ai_eval_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_eval_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
