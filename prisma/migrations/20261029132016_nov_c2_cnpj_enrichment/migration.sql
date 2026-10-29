-- CreateEnum
CREATE TYPE "CrmCnpjRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "crm_company_enrichments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "legal_name" TEXT,
    "trade_name" TEXT,
    "cnae_code" TEXT,
    "cnae_description" TEXT,
    "secondary_cnaes" JSONB NOT NULL DEFAULT '[]',
    "size" TEXT,
    "legal_nature" TEXT,
    "registration_status" TEXT,
    "opened_at" DATE,
    "share_capital" DECIMAL(16,2),
    "partners" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'brasilapi',
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_company_enrichments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_cnpj_enrichment_runs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "status" "CrmCnpjRunStatus" NOT NULL DEFAULT 'QUEUED',
    "only_missing" BOOLEAN NOT NULL DEFAULT true,
    "overwrite" BOOLEAN NOT NULL DEFAULT false,
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "enriched" INTEGER NOT NULL DEFAULT 0,
    "not_found" INTEGER NOT NULL DEFAULT 0,
    "invalid" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_cnpj_enrichment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_company_enrichments_company_id_key" ON "crm_company_enrichments"("company_id");

-- CreateIndex
CREATE INDEX "crm_company_enrichments_workspace_id_idx" ON "crm_company_enrichments"("workspace_id");

-- CreateIndex
CREATE INDEX "crm_cnpj_enrichment_runs_workspace_id_created_at_idx" ON "crm_cnpj_enrichment_runs"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_cnpj_enrichment_runs_workspace_id_status_idx" ON "crm_cnpj_enrichment_runs"("workspace_id", "status");

-- AddForeignKey
ALTER TABLE "crm_company_enrichments" ADD CONSTRAINT "crm_company_enrichments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
