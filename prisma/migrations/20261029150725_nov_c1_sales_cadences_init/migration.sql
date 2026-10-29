-- CreateEnum
CREATE TYPE "CrmCadenceStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CrmCadenceStepType" AS ENUM ('EMAIL', 'WHATSAPP', 'TASK');

-- CreateEnum
CREATE TYPE "CrmCadenceDelayUnit" AS ENUM ('MINUTES', 'HOURS', 'DAYS');

-- CreateEnum
CREATE TYPE "CrmCadenceEnrollmentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'REPLIED', 'COMPLETED', 'STOPPED');

-- CreateEnum
CREATE TYPE "CrmCadenceStopReason" AS ENUM ('REPLIED', 'MANUAL', 'LEAD_CLOSED', 'LEAD_DELETED', 'NO_CONTACT', 'CADENCE_ARCHIVED');

-- CreateEnum
CREATE TYPE "CrmCadenceRunStatus" AS ENUM ('SENT', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "crm_cadences" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CrmCadenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "email_from" TEXT,
    "email_reply_to" TEXT,
    "whatsapp_connection_id" TEXT,
    "stop_on_reply" BOOLEAN NOT NULL DEFAULT true,
    "window_start_hour" INTEGER,
    "window_end_hour" INTEGER,
    "weekdays_only" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "crm_cadences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_cadence_steps" (
    "id" TEXT NOT NULL,
    "cadence_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "CrmCadenceStepType" NOT NULL,
    "delay_value" INTEGER NOT NULL DEFAULT 0,
    "delay_unit" "CrmCadenceDelayUnit" NOT NULL DEFAULT 'DAYS',
    "subject" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "whatsapp_template_id" TEXT,
    "template_variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_cadence_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_cadence_enrollments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "cadence_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "status" "CrmCadenceEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "next_position" INTEGER NOT NULL DEFAULT 0,
    "next_run_at" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "stop_reason" "CrmCadenceStopReason",
    "replied_via" TEXT,
    "enrolled_by_id" TEXT NOT NULL,
    "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_cadence_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_cadence_runs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "cadence_id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "step_id" TEXT,
    "position" INTEGER NOT NULL,
    "type" "CrmCadenceStepType" NOT NULL,
    "status" "CrmCadenceRunStatus" NOT NULL,
    "detail" TEXT,
    "provider_message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_cadence_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_cadences_workspace_id_status_idx" ON "crm_cadences"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "crm_cadences_deleted_at_idx" ON "crm_cadences"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_cadence_steps_cadence_id_position_key" ON "crm_cadence_steps"("cadence_id", "position");

-- CreateIndex
CREATE INDEX "crm_cadence_enrollments_status_next_run_at_idx" ON "crm_cadence_enrollments"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "crm_cadence_enrollments_lead_id_idx" ON "crm_cadence_enrollments"("lead_id");

-- CreateIndex
CREATE INDEX "crm_cadence_enrollments_workspace_id_idx" ON "crm_cadence_enrollments"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_cadence_enrollments_cadence_id_lead_id_key" ON "crm_cadence_enrollments"("cadence_id", "lead_id");

-- CreateIndex
CREATE INDEX "crm_cadence_runs_enrollment_id_created_at_idx" ON "crm_cadence_runs"("enrollment_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_cadence_runs_cadence_id_status_idx" ON "crm_cadence_runs"("cadence_id", "status");

-- AddForeignKey
ALTER TABLE "crm_cadences" ADD CONSTRAINT "crm_cadences_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_cadence_steps" ADD CONSTRAINT "crm_cadence_steps_cadence_id_fkey" FOREIGN KEY ("cadence_id") REFERENCES "crm_cadences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_cadence_enrollments" ADD CONSTRAINT "crm_cadence_enrollments_cadence_id_fkey" FOREIGN KEY ("cadence_id") REFERENCES "crm_cadences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_cadence_enrollments" ADD CONSTRAINT "crm_cadence_enrollments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_cadence_runs" ADD CONSTRAINT "crm_cadence_runs_cadence_id_fkey" FOREIGN KEY ("cadence_id") REFERENCES "crm_cadences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_cadence_runs" ADD CONSTRAINT "crm_cadence_runs_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "crm_cadence_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
