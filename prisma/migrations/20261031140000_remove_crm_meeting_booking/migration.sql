-- Removes the CRM public meeting booking feature (C5): pages, hosts,
-- availability, bookings, the form hand-off column and the notification kind.
-- CRM calendar events and lead meetings (CrmLeadMeeting) are ordinary CRM data
-- and stay untouched.

-- DropTable (children first; the FKs also cascade)
DROP TABLE IF EXISTS "crm_meeting_bookings";
DROP TABLE IF EXISTS "crm_meeting_hosts";
DROP TABLE IF EXISTS "crm_meeting_availabilities";
DROP TABLE IF EXISTS "crm_meeting_pages";

-- DropEnum
DROP TYPE IF EXISTS "CrmMeetingBookingStatus";

-- AlterTable
ALTER TABLE "crm_forms" DROP COLUMN IF EXISTS "booking_page_id";

-- Drop the CRM_MEETING_BOOKED notification kind. Postgres cannot drop one enum
-- value, so the type is rebuilt from its current labels minus that one (built
-- dynamically so it stays correct when other migrations also change the list).
DELETE FROM "notification_preferences" WHERE "kind"::text = 'CRM_MEETING_BOOKED';
DELETE FROM "notifications" WHERE "kind"::text = 'CRM_MEETING_BOOKED';

DO $$
DECLARE
  labels text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'NotificationKind' AND e.enumlabel = 'CRM_MEETING_BOOKED'
  ) THEN
    SELECT string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder)
      INTO labels
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'NotificationKind' AND e.enumlabel <> 'CRM_MEETING_BOOKED';

    EXECUTE 'CREATE TYPE "NotificationKind_new" AS ENUM (' || labels || ')';
    ALTER TABLE "notifications"
      ALTER COLUMN "kind" TYPE "NotificationKind_new"
      USING ("kind"::text::"NotificationKind_new");
    ALTER TABLE "notification_preferences"
      ALTER COLUMN "kind" TYPE "NotificationKind_new"
      USING ("kind"::text::"NotificationKind_new");
    ALTER TYPE "NotificationKind" RENAME TO "NotificationKind_old";
    ALTER TYPE "NotificationKind_new" RENAME TO "NotificationKind";
    DROP TYPE "NotificationKind_old";
  END IF;
END $$;
