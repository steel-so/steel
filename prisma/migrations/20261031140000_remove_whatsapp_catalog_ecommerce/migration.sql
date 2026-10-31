-- Remove WhatsApp product catalog and cart (Z8) and e-commerce triggers (Z9).
-- Scheduling (Z10) tables are untouched.

DROP TABLE IF EXISTS "whatsapp_ecom_events";
DROP TABLE IF EXISTS "whatsapp_ecom_triggers";
DROP TABLE IF EXISTS "whatsapp_store_integrations";
DROP TABLE IF EXISTS "whatsapp_catalog_orders";
DROP TABLE IF EXISTS "whatsapp_catalog_products";
DROP TABLE IF EXISTS "whatsapp_commerce_settings";

DROP TYPE IF EXISTS "WhatsAppEcomEventStatus";
DROP TYPE IF EXISTS "WhatsAppEcomTriggerKind";
DROP TYPE IF EXISTS "WhatsAppEcomEventKind";
DROP TYPE IF EXISTS "WhatsAppStoreProvider";
DROP TYPE IF EXISTS "WhatsAppCatalogSource";
