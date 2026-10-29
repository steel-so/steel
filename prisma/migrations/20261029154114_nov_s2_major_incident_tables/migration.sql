-- CreateEnum
CREATE TYPE "SdMajorIncidentStatus" AS ENUM ('INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "SdMajorIncidentImpact" AS ENUM ('DEGRADED', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE');

-- CreateEnum
CREATE TYPE "SdIncidentLinkSource" AS ENUM ('MANUAL', 'SUGGESTION', 'MONITORING', 'AUTOMATION');

-- CreateEnum
CREATE TYPE "SdStatusChannel" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateTable
CREATE TABLE "sd_major_incidents" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "impact" "SdMajorIncidentImpact" NOT NULL DEFAULT 'PARTIAL_OUTAGE',
    "status" "SdMajorIncidentStatus" NOT NULL DEFAULT 'INVESTIGATING',
    "commander_id" TEXT,
    "swarm_id" TEXT,
    "declared_by_id" TEXT,
    "resolved_by_id" TEXT,
    "resolution" TEXT,
    "declared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sd_major_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sd_major_incident_tickets" (
    "incident_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "source" "SdIncidentLinkSource" NOT NULL DEFAULT 'MANUAL',
    "linked_by_id" TEXT,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sd_major_incident_tickets_pkey" PRIMARY KEY ("incident_id","ticket_id")
);

-- CreateTable
CREATE TABLE "sd_major_incident_updates" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "status" "SdMajorIncidentStatus" NOT NULL,
    "message" TEXT NOT NULL,
    "publish" BOOLEAN NOT NULL DEFAULT false,
    "author_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified_at" TIMESTAMP(3),
    "notify_total" INTEGER NOT NULL DEFAULT 0,
    "notify_sent" INTEGER NOT NULL DEFAULT 0,
    "notify_failed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sd_major_incident_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sd_status_pages" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "customer_id" TEXT,
    "service_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "published" BOOLEAN NOT NULL DEFAULT true,
    "allow_subscriptions" BOOLEAN NOT NULL DEFAULT true,
    "time_zone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sd_status_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sd_major_incident_pages" (
    "incident_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,

    CONSTRAINT "sd_major_incident_pages_pkey" PRIMARY KEY ("incident_id","page_id")
);

-- CreateTable
CREATE TABLE "sd_status_subscribers" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "channel" "SdStatusChannel" NOT NULL,
    "address" TEXT NOT NULL,
    "name" TEXT,
    "token" TEXT NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "added_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sd_status_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sd_major_incidents_workspace_id_status_idx" ON "sd_major_incidents"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "sd_major_incidents_ticket_id_status_idx" ON "sd_major_incidents"("ticket_id", "status");

-- CreateIndex
CREATE INDEX "sd_major_incident_tickets_ticket_id_idx" ON "sd_major_incident_tickets"("ticket_id");

-- CreateIndex
CREATE INDEX "sd_major_incident_tickets_workspace_id_idx" ON "sd_major_incident_tickets"("workspace_id");

-- CreateIndex
CREATE INDEX "sd_major_incident_updates_incident_id_created_at_idx" ON "sd_major_incident_updates"("incident_id", "created_at");

-- CreateIndex
CREATE INDEX "sd_major_incident_updates_workspace_id_idx" ON "sd_major_incident_updates"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "sd_status_pages_slug_key" ON "sd_status_pages"("slug");

-- CreateIndex
CREATE INDEX "sd_status_pages_workspace_id_idx" ON "sd_status_pages"("workspace_id");

-- CreateIndex
CREATE INDEX "sd_major_incident_pages_page_id_idx" ON "sd_major_incident_pages"("page_id");

-- CreateIndex
CREATE INDEX "sd_major_incident_pages_workspace_id_idx" ON "sd_major_incident_pages"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "sd_status_subscribers_token_key" ON "sd_status_subscribers"("token");

-- CreateIndex
CREATE INDEX "sd_status_subscribers_workspace_id_idx" ON "sd_status_subscribers"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "sd_status_subscribers_page_id_channel_address_key" ON "sd_status_subscribers"("page_id", "channel", "address");

-- AddForeignKey
ALTER TABLE "sd_major_incidents" ADD CONSTRAINT "sd_major_incidents_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "sd_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_major_incident_tickets" ADD CONSTRAINT "sd_major_incident_tickets_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "sd_major_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_major_incident_tickets" ADD CONSTRAINT "sd_major_incident_tickets_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "sd_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_major_incident_updates" ADD CONSTRAINT "sd_major_incident_updates_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "sd_major_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_major_incident_pages" ADD CONSTRAINT "sd_major_incident_pages_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "sd_major_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_major_incident_pages" ADD CONSTRAINT "sd_major_incident_pages_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "sd_status_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_status_subscribers" ADD CONSTRAINT "sd_status_subscribers_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "sd_status_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
