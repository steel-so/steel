-- CreateEnum
CREATE TYPE "SiteExperimentKind" AS ENUM ('SECTION', 'PAGE');

-- CreateEnum
CREATE TYPE "SiteExperimentStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "SiteExperimentEventKind" AS ENUM ('EXPOSURE', 'CONVERSION');

-- CreateTable
CREATE TABLE "site_experiments" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SiteExperimentKind" NOT NULL,
    "status" "SiteExperimentStatus" NOT NULL DEFAULT 'DRAFT',
    "control_node_id" TEXT,
    "variants" JSONB NOT NULL,
    "goal" JSONB NOT NULL,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "run" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "winner_key" TEXT,
    "fingerprints" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_experiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_experiment_events" (
    "id" TEXT NOT NULL,
    "experiment_id" TEXT NOT NULL,
    "run" INTEGER NOT NULL,
    "variant_key" TEXT NOT NULL,
    "kind" "SiteExperimentEventKind" NOT NULL,
    "visitor_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_experiment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_experiments_site_id_status_idx" ON "site_experiments"("site_id", "status");

-- CreateIndex
CREATE INDEX "site_experiment_events_experiment_id_run_variant_key_idx" ON "site_experiment_events"("experiment_id", "run", "variant_key");

-- CreateIndex
CREATE UNIQUE INDEX "site_experiment_events_experiment_id_run_kind_visitor_key_key" ON "site_experiment_events"("experiment_id", "run", "kind", "visitor_key");

-- AddForeignKey
ALTER TABLE "site_experiments" ADD CONSTRAINT "site_experiments_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_experiment_events" ADD CONSTRAINT "site_experiment_events_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "site_experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
