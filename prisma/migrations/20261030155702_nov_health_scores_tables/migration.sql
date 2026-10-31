-- CreateEnum
CREATE TYPE "CrmHealthLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'CRM_CUSTOMER_HEALTH_DROP';
ALTER TYPE "NotificationKind" ADD VALUE 'CRM_OPPORTUNITY_AT_RISK';

-- AlterTable
ALTER TABLE "crm_opportunities" ADD COLUMN     "contact_changed_at" TIMESTAMP(3),
ADD COLUMN     "stage_changed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "crm_customer_health" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "risk_score" INTEGER NOT NULL,
    "level" "CrmHealthLevel" NOT NULL,
    "factors" JSONB NOT NULL DEFAULT '[]',
    "missing" JSONB NOT NULL DEFAULT '[]',
    "next_action" JSONB NOT NULL,
    "signals" JSONB NOT NULL DEFAULT '{}',
    "previous_score" INTEGER,
    "previous_level" "CrmHealthLevel",
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_customer_health_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_opportunity_health" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "opportunity_id" TEXT NOT NULL,
    "risk_score" INTEGER NOT NULL,
    "level" "CrmHealthLevel" NOT NULL,
    "factors" JSONB NOT NULL DEFAULT '[]',
    "next_action" JSONB NOT NULL,
    "signals" JSONB NOT NULL DEFAULT '{}',
    "previous_score" INTEGER,
    "previous_level" "CrmHealthLevel",
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_opportunity_health_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_customer_health_company_id_key" ON "crm_customer_health"("company_id");

-- CreateIndex
CREATE INDEX "crm_customer_health_workspace_id_level_risk_score_idx" ON "crm_customer_health"("workspace_id", "level", "risk_score");

-- CreateIndex
CREATE INDEX "crm_customer_health_workspace_id_computed_at_idx" ON "crm_customer_health"("workspace_id", "computed_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_opportunity_health_opportunity_id_key" ON "crm_opportunity_health"("opportunity_id");

-- CreateIndex
CREATE INDEX "crm_opportunity_health_workspace_id_level_risk_score_idx" ON "crm_opportunity_health"("workspace_id", "level", "risk_score");

-- CreateIndex
CREATE INDEX "crm_opportunity_health_workspace_id_computed_at_idx" ON "crm_opportunity_health"("workspace_id", "computed_at");

-- AddForeignKey
ALTER TABLE "crm_customer_health" ADD CONSTRAINT "crm_customer_health_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_customer_health" ADD CONSTRAINT "crm_customer_health_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_opportunity_health" ADD CONSTRAINT "crm_opportunity_health_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_opportunity_health" ADD CONSTRAINT "crm_opportunity_health_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
