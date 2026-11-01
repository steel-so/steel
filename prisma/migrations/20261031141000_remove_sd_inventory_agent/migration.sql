-- Remove the ServiceDesk inventory agent: enrollment tokens, published
-- releases and the agent-only columns. Devices, alerts, software, SNMP targets
-- and discovery ranges are kept.
DROP TABLE IF EXISTS "sd_inventory_tokens";
DROP TABLE IF EXISTS "sd_inventory_agent_releases";
ALTER TABLE "sd_inventory_devices" DROP COLUMN IF EXISTS "agent_version";
ALTER TABLE "sd_inventory_devices" DROP COLUMN IF EXISTS "token_id";
ALTER TABLE "sd_inventory_settings" DROP COLUMN IF EXISTS "agent_auto_update";
