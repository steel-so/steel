-- CreateEnum
CREATE TYPE "WhatsAppCatalogSource" AS ENUM ('CRM', 'TRAY', 'NUVEMSHOP');

-- CreateEnum
CREATE TYPE "WhatsAppStoreProvider" AS ENUM ('TRAY', 'NUVEMSHOP', 'VTEX');

-- CreateEnum
CREATE TYPE "WhatsAppEcomEventKind" AS ENUM ('CART_ABANDONED', 'ORDER_CREATED', 'ORDER_SHIPPED', 'ORDER_DELIVERED');

-- CreateEnum
CREATE TYPE "WhatsAppEcomTriggerKind" AS ENUM ('ABANDONED_CART', 'ORDER_SHIPPED', 'POST_PURCHASE');

-- CreateEnum
CREATE TYPE "WhatsAppEcomEventStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "WhatsAppSchedAppointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "WhatsAppSchedAppointmentSource" AS ENUM ('AGENT', 'FLOW', 'CONTACT');

-- CreateTable
CREATE TABLE "whatsapp_commerce_settings" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "catalog_enabled" BOOLEAN NOT NULL DEFAULT false,
    "meta_catalog_id" TEXT,
    "catalog_source" "WhatsAppCatalogSource" NOT NULL DEFAULT 'CRM',
    "catalog_integration_id" TEXT,
    "store_sync_enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_catalog_sync_at" TIMESTAMP(3),
    "order_creates_opportunity" BOOLEAN NOT NULL DEFAULT true,
    "order_pipeline_id" TEXT,
    "order_pix_enabled" BOOLEAN NOT NULL DEFAULT false,
    "owner_user_id" TEXT,
    "triggers_enabled" BOOLEAN NOT NULL DEFAULT false,
    "throttle_hours" INTEGER NOT NULL DEFAULT 24,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_commerce_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_catalog_products" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "source" "WhatsAppCatalogSource" NOT NULL,
    "external_id" TEXT NOT NULL,
    "retailer_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "image_url" TEXT,
    "url" TEXT,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_catalog_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_catalog_orders" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "provider_message_id" TEXT NOT NULL,
    "meta_catalog_id" TEXT,
    "note" TEXT,
    "items" JSONB NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "lead_id" TEXT,
    "opportunity_id" TEXT,
    "pix_charge_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_catalog_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_store_integrations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "provider" "WhatsAppStoreProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "store_url" TEXT,
    "encrypted_webhook_secret" TEXT NOT NULL,
    "encrypted_credentials" TEXT,
    "last_event_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_store_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_ecom_triggers" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "kind" "WhatsAppEcomTriggerKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "template_id" TEXT,
    "delay_minutes" INTEGER NOT NULL DEFAULT 0,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_ecom_triggers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_ecom_events" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "kind" "WhatsAppEcomEventKind" NOT NULL,
    "external_id" TEXT NOT NULL,
    "wa_id" TEXT NOT NULL,
    "contact_name" TEXT,
    "data" JSONB NOT NULL,
    "status" "WhatsAppEcomEventStatus" NOT NULL DEFAULT 'PENDING',
    "skip_reason" TEXT,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "claimed_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "provider_message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_ecom_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_scheduling_settings" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "connection_id" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "slot_minutes" INTEGER NOT NULL DEFAULT 30,
    "min_notice_minutes" INTEGER NOT NULL DEFAULT 60,
    "max_days_ahead" INTEGER NOT NULL DEFAULT 30,
    "confirmation_template_id" TEXT,
    "reminder_template_id" TEXT,
    "reminder_offsets" INTEGER[] DEFAULT ARRAY[1440]::INTEGER[],
    "booking_flow_id" TEXT,
    "owner_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_scheduling_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_sched_services" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "duration_minutes" INTEGER NOT NULL,
    "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_sched_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_sched_professionals" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "user_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "working_hours" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_sched_professionals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_sched_professional_services" (
    "professional_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,

    CONSTRAINT "whatsapp_sched_professional_services_pkey" PRIMARY KEY ("professional_id","service_id")
);

-- CreateTable
CREATE TABLE "whatsapp_sched_appointments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "professional_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" "WhatsAppSchedAppointmentStatus" NOT NULL DEFAULT 'PENDING',
    "source" "WhatsAppSchedAppointmentSource" NOT NULL DEFAULT 'AGENT',
    "notes" TEXT,
    "created_by_id" TEXT,
    "confirmation_sent_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "reminders_sent" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_sched_appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_commerce_settings_workspace_id_key" ON "whatsapp_commerce_settings"("workspace_id");

-- CreateIndex
CREATE INDEX "whatsapp_catalog_products_workspace_id_available_idx" ON "whatsapp_catalog_products"("workspace_id", "available");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_catalog_products_workspace_id_retailer_id_key" ON "whatsapp_catalog_products"("workspace_id", "retailer_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_catalog_orders_provider_message_id_key" ON "whatsapp_catalog_orders"("provider_message_id");

-- CreateIndex
CREATE INDEX "whatsapp_catalog_orders_workspace_id_created_at_idx" ON "whatsapp_catalog_orders"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_catalog_orders_conversation_id_idx" ON "whatsapp_catalog_orders"("conversation_id");

-- CreateIndex
CREATE INDEX "whatsapp_store_integrations_workspace_id_idx" ON "whatsapp_store_integrations"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_ecom_triggers_workspace_id_kind_key" ON "whatsapp_ecom_triggers"("workspace_id", "kind");

-- CreateIndex
CREATE INDEX "whatsapp_ecom_events_status_scheduled_at_idx" ON "whatsapp_ecom_events"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "whatsapp_ecom_events_workspace_id_created_at_idx" ON "whatsapp_ecom_events"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_ecom_events_workspace_id_wa_id_idx" ON "whatsapp_ecom_events"("workspace_id", "wa_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_ecom_events_integration_id_kind_external_id_key" ON "whatsapp_ecom_events"("integration_id", "kind", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_scheduling_settings_workspace_id_key" ON "whatsapp_scheduling_settings"("workspace_id");

-- CreateIndex
CREATE INDEX "whatsapp_sched_services_workspace_id_idx" ON "whatsapp_sched_services"("workspace_id");

-- CreateIndex
CREATE INDEX "whatsapp_sched_professionals_workspace_id_idx" ON "whatsapp_sched_professionals"("workspace_id");

-- CreateIndex
CREATE INDEX "whatsapp_sched_professional_services_service_id_idx" ON "whatsapp_sched_professional_services"("service_id");

-- CreateIndex
CREATE INDEX "whatsapp_sched_appointments_workspace_id_starts_at_idx" ON "whatsapp_sched_appointments"("workspace_id", "starts_at");

-- CreateIndex
CREATE INDEX "whatsapp_sched_appointments_professional_id_starts_at_idx" ON "whatsapp_sched_appointments"("professional_id", "starts_at");

-- CreateIndex
CREATE INDEX "whatsapp_sched_appointments_contact_id_status_idx" ON "whatsapp_sched_appointments"("contact_id", "status");

-- CreateIndex
CREATE INDEX "whatsapp_sched_appointments_status_starts_at_idx" ON "whatsapp_sched_appointments"("status", "starts_at");

-- AddForeignKey
ALTER TABLE "whatsapp_commerce_settings" ADD CONSTRAINT "whatsapp_commerce_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_catalog_products" ADD CONSTRAINT "whatsapp_catalog_products_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_catalog_orders" ADD CONSTRAINT "whatsapp_catalog_orders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_catalog_orders" ADD CONSTRAINT "whatsapp_catalog_orders_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "whatsapp_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_store_integrations" ADD CONSTRAINT "whatsapp_store_integrations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_ecom_triggers" ADD CONSTRAINT "whatsapp_ecom_triggers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_ecom_events" ADD CONSTRAINT "whatsapp_ecom_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_ecom_events" ADD CONSTRAINT "whatsapp_ecom_events_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "whatsapp_store_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_scheduling_settings" ADD CONSTRAINT "whatsapp_scheduling_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_sched_services" ADD CONSTRAINT "whatsapp_sched_services_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_sched_professionals" ADD CONSTRAINT "whatsapp_sched_professionals_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_sched_professional_services" ADD CONSTRAINT "whatsapp_sched_professional_services_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "whatsapp_sched_professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_sched_professional_services" ADD CONSTRAINT "whatsapp_sched_professional_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "whatsapp_sched_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_sched_appointments" ADD CONSTRAINT "whatsapp_sched_appointments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_sched_appointments" ADD CONSTRAINT "whatsapp_sched_appointments_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "whatsapp_sched_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_sched_appointments" ADD CONSTRAINT "whatsapp_sched_appointments_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "whatsapp_sched_professionals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_sched_appointments" ADD CONSTRAINT "whatsapp_sched_appointments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "whatsapp_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Two live appointments cannot start at the same time for one professional.
CREATE UNIQUE INDEX "whatsapp_sched_appointments_live_slot_key"
  ON "whatsapp_sched_appointments" ("professional_id", "starts_at")
  WHERE "status" IN ('PENDING', 'CONFIRMED');
