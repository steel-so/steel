-- CreateEnum
CREATE TYPE "SdSwarmStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "SdSwarmMemberStatus" AS ENUM ('INVITED', 'JOINED', 'DECLINED');

-- CreateTable
CREATE TABLE "sd_swarms" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "status" "SdSwarmStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "outcome" TEXT,
    "slack_channel_id" TEXT,
    "slack_channel_name" TEXT,
    "slack_error" TEXT,
    "slack_archived_at" TIMESTAMP(3),
    "started_by_id" TEXT,
    "closed_by_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "sd_swarms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sd_swarm_members" (
    "swarm_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "SdSwarmMemberStatus" NOT NULL DEFAULT 'INVITED',
    "invited_by_id" TEXT,
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),

    CONSTRAINT "sd_swarm_members_pkey" PRIMARY KEY ("swarm_id","user_id")
);

-- CreateIndex
CREATE INDEX "sd_swarms_ticket_id_status_idx" ON "sd_swarms"("ticket_id", "status");

-- CreateIndex
CREATE INDEX "sd_swarms_workspace_id_status_idx" ON "sd_swarms"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "sd_swarm_members_user_id_status_idx" ON "sd_swarm_members"("user_id", "status");

-- AddForeignKey
ALTER TABLE "sd_swarms" ADD CONSTRAINT "sd_swarms_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "sd_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_swarms" ADD CONSTRAINT "sd_swarms_started_by_id_fkey" FOREIGN KEY ("started_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_swarms" ADD CONSTRAINT "sd_swarms_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_swarm_members" ADD CONSTRAINT "sd_swarm_members_swarm_id_fkey" FOREIGN KEY ("swarm_id") REFERENCES "sd_swarms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_swarm_members" ADD CONSTRAINT "sd_swarm_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
