-- cadastro-unico (ADR 0066): optional links between the CRM registry and the
-- ServiceDesk / WhatsApp registries. All columns are nullable and additive.

-- AlterTable
ALTER TABLE "sd_customers" ADD COLUMN "crm_company_id" TEXT;

-- AlterTable
ALTER TABLE "sd_contacts" ADD COLUMN "crm_person_id" TEXT;

-- AlterTable
ALTER TABLE "whatsapp_contacts" ADD COLUMN "crm_person_id" TEXT;

-- CreateIndex
CREATE INDEX "sd_customers_crm_company_id_idx" ON "sd_customers"("crm_company_id");

-- CreateIndex
CREATE INDEX "sd_contacts_crm_person_id_idx" ON "sd_contacts"("crm_person_id");

-- CreateIndex
CREATE INDEX "whatsapp_contacts_crm_person_id_idx" ON "whatsapp_contacts"("crm_person_id");

-- AddForeignKey
ALTER TABLE "sd_customers" ADD CONSTRAINT "sd_customers_crm_company_id_fkey" FOREIGN KEY ("crm_company_id") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_contacts" ADD CONSTRAINT "sd_contacts_crm_person_id_fkey" FOREIGN KEY ("crm_person_id") REFERENCES "crm_people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_crm_person_id_fkey" FOREIGN KEY ("crm_person_id") REFERENCES "crm_people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill (idempotent: only rows still unlinked, only when the match is
-- unambiguous, i.e. exactly one live CRM record in the same workspace).

-- 1. SD customer -> CRM company by CNPJ (digits only on both sides).
UPDATE "sd_customers" AS c
SET "crm_company_id" = m."company_id"
FROM (
    SELECT s."id" AS "customer_id", MIN(k."id") AS "company_id"
    FROM "sd_customers" s
    JOIN "crm_companies" k
      ON k."workspace_id" = s."workspace_id"
     AND k."deleted_at" IS NULL
     AND k."cnpj" IS NOT NULL
     AND regexp_replace(k."cnpj", '\D', '', 'g') = s."document"
    WHERE s."crm_company_id" IS NULL
      AND s."deleted_at" IS NULL
      AND s."document" IS NOT NULL
      AND length(s."document") = 14
    GROUP BY s."id"
    HAVING COUNT(*) = 1
) AS m
WHERE c."id" = m."customer_id"
  AND c."crm_company_id" IS NULL;

-- 2. SD contact -> CRM person by e-mail (case-insensitive).
UPDATE "sd_contacts" AS c
SET "crm_person_id" = m."person_id"
FROM (
    SELECT s."id" AS "contact_id", MIN(p."id") AS "person_id"
    FROM "sd_contacts" s
    JOIN "crm_people" p
      ON p."workspace_id" = s."workspace_id"
     AND p."deleted_at" IS NULL
     AND EXISTS (
         SELECT 1 FROM unnest(p."emails") AS e WHERE lower(e) = lower(s."email")
     )
    WHERE s."crm_person_id" IS NULL
      AND s."deleted_at" IS NULL
      AND s."email" IS NOT NULL
      AND s."email" <> ''
    GROUP BY s."id"
    HAVING COUNT(*) = 1
) AS m
WHERE c."id" = m."contact_id"
  AND c."crm_person_id" IS NULL;

-- 3. SD contact -> CRM person by phone key (DDD + last 8 digits), for the
--    contacts the e-mail step left unlinked.
UPDATE "sd_contacts" AS c
SET "crm_person_id" = m."person_id"
FROM (
    SELECT k."id" AS "contact_id", MIN(pk."person_id") AS "person_id"
    FROM (
        SELECT s."id", s."workspace_id",
               left(n.nat, 2) || right(n.nat, 8) AS "key"
        FROM "sd_contacts" s
        CROSS JOIN LATERAL (
            SELECT CASE
                WHEN d LIKE '55%' AND length(d) IN (12, 13) THEN substr(d, 3)
                ELSE d
            END AS nat
            FROM (
                SELECT regexp_replace(coalesce(s."whatsapp", s."phone", ''), '\D', '', 'g') AS d
            ) digits
        ) n
        WHERE s."crm_person_id" IS NULL
          AND s."deleted_at" IS NULL
          AND length(n.nat) IN (10, 11)
    ) k
    JOIN (
        SELECT p."id" AS "person_id", p."workspace_id",
               left(n.nat, 2) || right(n.nat, 8) AS "key"
        FROM "crm_people" p
        CROSS JOIN LATERAL unnest(p."phones") AS phone
        CROSS JOIN LATERAL (
            SELECT CASE
                WHEN d LIKE '55%' AND length(d) IN (12, 13) THEN substr(d, 3)
                ELSE d
            END AS nat
            FROM (SELECT regexp_replace(phone, '\D', '', 'g') AS d) digits
        ) n
        WHERE p."deleted_at" IS NULL
          AND length(n.nat) IN (10, 11)
    ) pk
      ON pk."workspace_id" = k."workspace_id" AND pk."key" = k."key"
    GROUP BY k."id"
    HAVING COUNT(DISTINCT pk."person_id") = 1
) AS m
WHERE c."id" = m."contact_id"
  AND c."crm_person_id" IS NULL;

-- 4. WhatsApp contact -> CRM person by phone key. `wa_id` is the phone in
--    digits (BSUID-only contacts are skipped).
UPDATE "whatsapp_contacts" AS c
SET "crm_person_id" = m."person_id"
FROM (
    SELECT k."id" AS "contact_id", MIN(pk."person_id") AS "person_id"
    FROM (
        SELECT w."id", w."workspace_id",
               left(n.nat, 2) || right(n.nat, 8) AS "key"
        FROM "whatsapp_contacts" w
        CROSS JOIN LATERAL (
            SELECT CASE
                WHEN w."wa_id" LIKE '55%' AND length(w."wa_id") IN (12, 13)
                    THEN substr(w."wa_id", 3)
                ELSE w."wa_id"
            END AS nat
        ) n
        WHERE w."crm_person_id" IS NULL
          AND w."wa_id" ~ '^[0-9]+$'
          AND length(n.nat) IN (10, 11)
    ) k
    JOIN (
        SELECT p."id" AS "person_id", p."workspace_id",
               left(n.nat, 2) || right(n.nat, 8) AS "key"
        FROM "crm_people" p
        CROSS JOIN LATERAL unnest(p."phones") AS phone
        CROSS JOIN LATERAL (
            SELECT CASE
                WHEN d LIKE '55%' AND length(d) IN (12, 13) THEN substr(d, 3)
                ELSE d
            END AS nat
            FROM (SELECT regexp_replace(phone, '\D', '', 'g') AS d) digits
        ) n
        WHERE p."deleted_at" IS NULL
          AND length(n.nat) IN (10, 11)
    ) pk
      ON pk."workspace_id" = k."workspace_id" AND pk."key" = k."key"
    GROUP BY k."id"
    HAVING COUNT(DISTINCT pk."person_id") = 1
) AS m
WHERE c."id" = m."contact_id"
  AND c."crm_person_id" IS NULL;
