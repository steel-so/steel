import z from 'zod'
import type { PublicNewsletterArchiveDTO } from './crm-newsletter-issue.schema'

/**
 * Public archive of a newsletter (slice nl-archive, ADR 0054): the
 * archive home, the web version of an issue, the RSS feed and the two Sites
 * elements (`site.newsletter-subscribe`, `site.newsletter-issues`). The base
 * DTO (`PublicNewsletterArchiveDTO`) lives in the contract; this file only
 * adds what the pages need on top of it.
 */

/** Issue cards per archive page. */
export const NEWSLETTER_ARCHIVE_PAGE_SIZE = 12
/** Items of the RSS feed (newest first). */
export const NEWSLETTER_RSS_LIMIT = 50
/** Most issues a `site.newsletter-issues` element may list. */
export const NEWSLETTER_SITE_ISSUES_MAX = 12

/** `?pagina=` of the archive home; anything invalid falls back to 1. */
export const NewsletterArchivePageSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(10_000)
  .catch(1)

export type NewsletterArchivePaginationDTO = {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

/** Archive home: the contract DTO plus paging and what the subscribe form
 * needs to pick its success copy. */
export type PublicNewsletterArchivePageDTO = PublicNewsletterArchiveDTO & {
  newsletter: PublicNewsletterArchiveDTO['newsletter'] & {
    /** True → the form says "confira seu e-mail" after subscribing. */
    doubleOptIn: boolean
  }
  pagination: NewsletterArchivePaginationDTO
}

export type PublicNewsletterIssueSummaryDTO =
  PublicNewsletterArchiveDTO['issues'][number]

/** Web version of one SENT issue. */
export type PublicNewsletterIssuePageDTO = {
  workspaceName: string
  workspaceSlug: string
  newsletter: PublicNewsletterArchivePageDTO['newsletter']
  issue: PublicNewsletterIssueSummaryDTO & {
    preheader: string | null
    /** HTML of the web version (no personal data). Rendered in a sandboxed
     * iframe, never inlined into the page. */
    webHtml: string
  }
  /** Older issue (lower number). */
  previous: Pick<
    PublicNewsletterIssueSummaryDTO,
    'number' | 'subject' | 'slug'
  > | null
  /** Newer issue (higher number). */
  next: Pick<
    PublicNewsletterIssueSummaryDTO,
    'number' | 'subject' | 'slug'
  > | null
}

/** RSS 2.0 feed: the newsletter and its last 50 SENT issues. */
export type PublicNewsletterFeedDTO = Omit<
  PublicNewsletterArchivePageDTO,
  'pagination'
>

/** What a published site needs of one newsletter (keyed by id). */
export type SiteLiveNewsletter = {
  workspaceSlug: string
  slug: string
  name: string
  doubleOptIn: boolean
  /** Public archive is on: the issue links work. */
  archiveEnabled: boolean
  /** Absolute URL of the archive (issue = `<archiveUrl>/<slug>`); absolute
   * because a site may live on its own host. */
  archiveUrl: string
  issues: PublicNewsletterIssueSummaryDTO[]
}

/** Picker of the Sites editor: the workspace's ACTIVE newsletters. */
export type SiteNewsletterOptionDTO = SiteLiveNewsletter & { id: string }
