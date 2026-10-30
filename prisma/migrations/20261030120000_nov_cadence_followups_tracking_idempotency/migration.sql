-- AlterEnum
ALTER TYPE "CrmCadenceRunStatus" ADD VALUE 'PENDING';

-- AlterEnum
ALTER TYPE "CrmCadenceStopReason" ADD VALUE 'CLICKED';

-- AlterTable
ALTER TABLE "crm_cadence_runs" ADD COLUMN     "click_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "clicked_at" TIMESTAMP(3),
ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "open_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "opened_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "crm_cadences" ADD COLUMN     "stop_on_click" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "crm_cadence_runs_idempotency_key_key" ON "crm_cadence_runs"("idempotency_key");

