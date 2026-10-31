-- Removes the CRM prospecting and enrichment agent (T5).

-- DropTable
DROP TABLE IF EXISTS "crm_prospect_drafts";

-- DropTable
DROP TABLE IF EXISTS "crm_prospect_usage";

-- DropTable
DROP TABLE IF EXISTS "crm_prospecting_settings";

-- DropEnum
DROP TYPE IF EXISTS "CrmProspectDraftStatus";

-- DropEnum
DROP TYPE IF EXISTS "CrmProspectChannel";
