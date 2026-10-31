-- AlterTable
ALTER TABLE "whatsapp_cost_entries" ADD COLUMN     "via_marketing_lite" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "whatsapp_prices" ADD COLUMN     "lite_unit_price" DECIMAL(12,6);
