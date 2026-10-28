import { cacheLife, cacheTag } from 'next/cache'
import type { AppError } from '@/src/errors/app-error'
import { newsletterArchiveTag } from '@/src/lib/newsletter/archive-cache'
import type { Result } from '@/src/lib/result'
import type {
  PublicNewsletterArchivePageDTO,
  PublicNewsletterFeedDTO,
  PublicNewsletterIssuePageDTO,
} from '@/src/schemas/crm-newsletter-archive.schema'
import { CrmNewsletterArchiveService } from '@/src/services/crm-newsletter-archive.service'

/**
 * Cached reads of the public archive, tagged
 * `newsletter-archive:<ws>/<newsletter>` — `revalidateNewsletterArchive`
 * (called when an issue is sent or the newsletter changes) expires them.
 * `hours` is only the safety net for a change that forgot to expire it.
 *
 * A 404 is cached too (a probe for an unknown slug does not hit the
 * database every time); any other failure throws, so it is never cached
 * and the error boundary answers.
 */

const NOT_FOUND_CODES = new Set([
  'CRM_NEWSLETTER_NOT_FOUND',
  'CRM_NEWSLETTER_ISSUE_NOT_FOUND',
])

function valueOrNull<T>(result: Result<T, AppError>): T | null {
  if (result.ok) return result.value
  if (NOT_FOUND_CODES.has(result.error.code)) return null
  throw new Error(`newsletter archive read failed: ${result.error.code}`)
}

export async function loadNewsletterArchive(
  workspaceSlug: string,
  newsletterSlug: string,
  page: number,
): Promise<PublicNewsletterArchivePageDTO | null> {
  'use cache'
  cacheTag(newsletterArchiveTag(workspaceSlug, newsletterSlug))
  cacheLife('hours')
  return valueOrNull(
    await CrmNewsletterArchiveService.getArchive(
      workspaceSlug,
      newsletterSlug,
      page,
    ),
  )
}

export async function loadNewsletterIssue(
  workspaceSlug: string,
  newsletterSlug: string,
  issueSlug: string,
): Promise<PublicNewsletterIssuePageDTO | null> {
  'use cache'
  cacheTag(newsletterArchiveTag(workspaceSlug, newsletterSlug))
  cacheLife('hours')
  return valueOrNull(
    await CrmNewsletterArchiveService.getIssue(
      workspaceSlug,
      newsletterSlug,
      issueSlug,
    ),
  )
}

export async function loadNewsletterFeed(
  workspaceSlug: string,
  newsletterSlug: string,
): Promise<PublicNewsletterFeedDTO | null> {
  'use cache'
  cacheTag(newsletterArchiveTag(workspaceSlug, newsletterSlug))
  cacheLife('hours')
  return valueOrNull(
    await CrmNewsletterArchiveService.getFeed(workspaceSlug, newsletterSlug),
  )
}
