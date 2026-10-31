-- CreateEnum
CREATE TYPE "CrmPaymentMethod" AS ENUM ('PIX', 'BOLETO');

-- CreateEnum
CREATE TYPE "CrmProposalChargeStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'CANCELED');

-- CreateEnum
CREATE TYPE "CrmContractStatus" AS ENUM ('ACTIVE', 'RENEWED', 'EXPIRED', 'CANCELED');

-- CreateEnum
CREATE TYPE "CrmDealRoomActionOwner" AS ENUM ('SELLER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "CrmDealRoomAuthorKind" AS ENUM ('SELLER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "CrmDealRoomEventKind" AS ENUM ('ROOM_OPENED', 'PROPOSAL_VIEWED', 'MATERIAL_OPENED', 'ACTION_COMPLETED', 'MESSAGE_SENT');

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'CRM_CONTRACT_EXPIRING';
ALTER TYPE "NotificationKind" ADD VALUE 'CRM_PROPOSAL_PAID';
ALTER TYPE "NotificationKind" ADD VALUE 'CRM_DEAL_ROOM_ACTIVITY';

-- CreateTable
CREATE TABLE "crm_deals_settings" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "proposal_payment_enabled" BOOLEAN NOT NULL DEFAULT false,
    "proposal_signature_enabled" BOOLEAN NOT NULL DEFAULT false,
    "renewal_lead_days" INTEGER NOT NULL DEFAULT 60,
    "renewal_auto_create" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_deals_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_proposal_signatures" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "signer_name" TEXT NOT NULL,
    "signer_document" TEXT,
    "signer_email" TEXT,
    "storage_key" TEXT NOT NULL,
    "image_sha256" TEXT NOT NULL,
    "proposal_sha256" TEXT NOT NULL,
    "ip_hash" TEXT NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_proposal_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_proposal_charges" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "opportunity_id" TEXT,
    "created_by_id" TEXT,
    "method" "CrmPaymentMethod" NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_charge_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" VARCHAR(140) NOT NULL,
    "payment_code" TEXT NOT NULL,
    "status" "CrmProposalChargeStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "paid_amount" DECIMAL(14,2),
    "end_to_end_id" TEXT,
    "payer_name" TEXT,
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_proposal_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_contracts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "opportunity_id" TEXT,
    "renewal_opportunity_id" TEXT,
    "owner_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" DECIMAL(14,2),
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "auto_renews" BOOLEAN NOT NULL DEFAULT false,
    "status" "CrmContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "alerted_at" TIMESTAMP(3),
    "renewal_created_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "crm_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deal_rooms" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "opportunity_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT,
    "welcome_message" TEXT,
    "proposal_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_deal_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deal_room_materials" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_deal_room_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deal_room_actions" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "owner" "CrmDealRoomActionOwner" NOT NULL,
    "due_date" TIMESTAMP(3),
    "done_at" TIMESTAMP(3),
    "done_by_label" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_deal_room_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deal_room_visitors" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip_hash" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_deal_room_visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deal_room_events" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "visitor_id" TEXT,
    "kind" "CrmDealRoomEventKind" NOT NULL,
    "target_id" TEXT,
    "target_label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_deal_room_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deal_room_messages" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "author_kind" "CrmDealRoomAuthorKind" NOT NULL,
    "author_user_id" TEXT,
    "author_name" TEXT NOT NULL,
    "visitor_id" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_deal_room_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_deals_settings_workspace_id_key" ON "crm_deals_settings"("workspace_id");

-- CreateIndex
CREATE INDEX "crm_proposal_signatures_proposal_id_idx" ON "crm_proposal_signatures"("proposal_id");

-- CreateIndex
CREATE INDEX "crm_proposal_signatures_workspace_id_idx" ON "crm_proposal_signatures"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_proposal_charges_provider_provider_charge_id_key" ON "crm_proposal_charges"("provider", "provider_charge_id");

-- CreateIndex
CREATE INDEX "crm_proposal_charges_proposal_id_created_at_idx" ON "crm_proposal_charges"("proposal_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_proposal_charges_workspace_id_status_idx" ON "crm_proposal_charges"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "crm_contracts_workspace_id_status_end_date_idx" ON "crm_contracts"("workspace_id", "status", "end_date");

-- CreateIndex
CREATE INDEX "crm_contracts_company_id_idx" ON "crm_contracts"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_deal_rooms_opportunity_id_key" ON "crm_deal_rooms"("opportunity_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_deal_rooms_token_key" ON "crm_deal_rooms"("token");

-- CreateIndex
CREATE INDEX "crm_deal_rooms_workspace_id_idx" ON "crm_deal_rooms"("workspace_id");

-- CreateIndex
CREATE INDEX "crm_deal_room_materials_room_id_position_idx" ON "crm_deal_room_materials"("room_id", "position");

-- CreateIndex
CREATE INDEX "crm_deal_room_actions_room_id_position_idx" ON "crm_deal_room_actions"("room_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "crm_deal_room_visitors_room_id_email_key" ON "crm_deal_room_visitors"("room_id", "email");

-- CreateIndex
CREATE INDEX "crm_deal_room_events_room_id_created_at_idx" ON "crm_deal_room_events"("room_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_deal_room_messages_room_id_created_at_idx" ON "crm_deal_room_messages"("room_id", "created_at");

-- AddForeignKey
ALTER TABLE "crm_deals_settings" ADD CONSTRAINT "crm_deals_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_signatures" ADD CONSTRAINT "crm_proposal_signatures_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "crm_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_charges" ADD CONSTRAINT "crm_proposal_charges_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "crm_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_charges" ADD CONSTRAINT "crm_proposal_charges_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contracts" ADD CONSTRAINT "crm_contracts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contracts" ADD CONSTRAINT "crm_contracts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contracts" ADD CONSTRAINT "crm_contracts_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contracts" ADD CONSTRAINT "crm_contracts_renewal_opportunity_id_fkey" FOREIGN KEY ("renewal_opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_rooms" ADD CONSTRAINT "crm_deal_rooms_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_rooms" ADD CONSTRAINT "crm_deal_rooms_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_rooms" ADD CONSTRAINT "crm_deal_rooms_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "crm_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_room_materials" ADD CONSTRAINT "crm_deal_room_materials_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "crm_deal_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_room_actions" ADD CONSTRAINT "crm_deal_room_actions_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "crm_deal_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_room_visitors" ADD CONSTRAINT "crm_deal_room_visitors_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "crm_deal_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_room_events" ADD CONSTRAINT "crm_deal_room_events_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "crm_deal_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_room_events" ADD CONSTRAINT "crm_deal_room_events_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "crm_deal_room_visitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_room_messages" ADD CONSTRAINT "crm_deal_room_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "crm_deal_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_room_messages" ADD CONSTRAINT "crm_deal_room_messages_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "crm_deal_room_visitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
