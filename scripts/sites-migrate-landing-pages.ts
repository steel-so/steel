import { prisma } from '@/src/lib/prisma'
import { SiteLandingMigrationService } from '@/src/services/site-landing-migration.service'

/**
 * Turns every CRM landing page into a one-page site (sites wave S1).
 * Idempotent: a landing page that already has a site is skipped, so it is
 * safe to run again. Published landing pages are published as version 1 and
 * their `/l/<token>` link starts redirecting to the site.
 *
 *   pnpm sites:migrate-landing-pages [--workspace=<workspaceId>]
 */
async function main() {
  const workspaceArg = process.argv
    .slice(2)
    .find((arg) => arg.startsWith('--workspace='))
  const workspaceId = workspaceArg?.split('=')[1] || undefined

  const result = await SiteLandingMigrationService.migrateAll(workspaceId)
  if (!result.ok) {
    console.error(`Migration failed: ${result.error.message}`)
    process.exitCode = 1
    return
  }

  for (const item of result.value.items) {
    console.log(
      `${item.status.padEnd(8)} landing ${item.landingPageId} → site ${item.slug}${item.published ? ' (published)' : ''}`,
    )
  }
  console.log(
    `Created: ${result.value.created}. Skipped: ${result.value.skipped}. Failed: ${result.value.failed}.`,
  )
  if (result.value.failed > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
