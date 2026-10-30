-- AlterEnum
ALTER TYPE "CrmCnpjRunStatus" ADD VALUE 'CANCELED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'AGENT_VERSION_GATE_FINISHED';
ALTER TYPE "NotificationKind" ADD VALUE 'AGENT_SIMULATION_FINISHED';
ALTER TYPE "NotificationKind" ADD VALUE 'CRM_CNPJ_ENRICHMENT_FINISHED';

-- AlterTable
ALTER TABLE "crm_cnpj_enrichment_runs" ADD COLUMN     "cancel_requested_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "steel_agent_simulations" ADD COLUMN     "agent_version_id" TEXT;

-- AlterTable
ALTER TABLE "steel_agent_versions" ADD COLUMN     "sim_passed" INTEGER,
ADD COLUMN     "sim_total" INTEGER,
ADD COLUMN     "simulation_id" TEXT;

-- AlterTable
ALTER TABLE "steel_agents" ADD COLUMN     "sim_gate_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sim_gate_min_pass_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.8;
