-- AlterEnum
ALTER TYPE "SteelAgentRunStepKind" ADD VALUE 'GUARDRAIL';

-- AlterTable
ALTER TABLE "steel_agent_runs" ADD COLUMN     "rerun_of_id" TEXT;
