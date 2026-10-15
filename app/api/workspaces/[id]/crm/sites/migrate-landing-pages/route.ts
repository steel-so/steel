import { SiteLandingMigrationService } from '@/src/services/site-landing-migration.service'
import { siteRoute } from '../_lib/handler'

type Params = { id: string }

/** Turns every landing page of the workspace into a site (admins only;
 * idempotent — pages already migrated are skipped). */
export const POST = siteRoute<Params>(
  { consent: '/api/workspaces/[id]/crm/sites/migrate-landing-pages' },
  ({ userId, params }) =>
    SiteLandingMigrationService.migrateWorkspace(userId, params.id),
)
