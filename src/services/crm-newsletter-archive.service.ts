import { logger } from '@/lib/axiom/logger'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import { crmNewsletterNotFound } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toPublicArchiveNewsletter,
  toPublicIssueSummary,
  toSiteNewsletterOption,
} from '@/src/mappers/crm-newsletter-archive.mapper'
import {
  type ArchiveNewsletterRow,
  CrmNewsletterArchiveRepository,
} from '@/src/repositories/crm-newsletter-archive.repository'
import {
  NEWSLETTER_ARCHIVE_PAGE_SIZE,
  NEWSLETTER_RSS_LIMIT,
  NEWSLETTER_SITE_ISSUES_MAX,
  type PublicNewsletterArchivePageDTO,
  type PublicNewsletterFeedDTO,
  type PublicNewsletterIssuePageDTO,
  type SiteLiveNewsletter,
  type SiteNewsletterOptionDTO,
} from '@/src/schemas/crm-newsletter-archive.schema'
import { assertModuleEnabled } from './authz'
import { assertSitesPermission } from './site-access'

/**
 * Public archive of the CRM newsletter (ADR 0054, slice nl-archive): the
 * archive home `/n/<ws>/<newsletter>`, the web version of each SENT issue,
 * the RSS feed and the data of the two Sites elements.
 *
 * Everything public answers CRM_NEWSLETTER_NOT_FOUND (404) alike when the
 * newsletter is missing, archived, has the archive off, its workspace is
 * not ACTIVE or the CRM module is off — a visitor learns nothing about why.
 */

type PublicNewsletter = {
  row: ArchiveNewsletterRow
  base: Omit<PublicNewsletterFeedDTO, 'issues'>
}

async function loadPublicNewsletter(
  workspaceSlug: string,
  newsletterSlug: string,
): Promise<Result<PublicNewsletter>> {
  const found = await CrmNewsletterArchiveRepository.findPublicNewsletter(
    workspaceSlug,
    newsletterSlug,
  )
  if (!found.ok) return found
  const row = found.value

  const enabled = await assertModuleEnabled(row.workspaceId, 'CRM')
  if (!enabled.ok) {
    if (enabled.error.code !== 'MODULE_DISABLED') return enabled
    return err(crmNewsletterNotFound())
  }

  return ok({
    row,
    base: {
      workspaceName: row.workspace.name,
      workspaceSlug: row.workspace.slug,
      newsletter: toPublicArchiveNewsletter(row),
    },
  })
}

const ARCHIVE_NOT_FOUND = new Set([
  'CRM_NEWSLETTER_NOT_FOUND',
  'CRM_NEWSLETTER_ISSUE_NOT_FOUND',
])

export const CrmNewsletterArchiveService = {
  /**
   * Whether an archive page exists, for the proxy to answer a real 404
   * before rendering (the App Router answers 200 once it starts streaming).
   * Same rules as `getArchive`/`getIssue`; any other failure is an error,
   * and the proxy then lets the page decide.
   */
  async pageExists(
    workspaceSlug: string,
    newsletterSlug: string,
    issueSlug?: string,
  ): Promise<Result<boolean>> {
    const newsletter = await loadPublicNewsletter(workspaceSlug, newsletterSlug)
    if (!newsletter.ok) {
      return ARCHIVE_NOT_FOUND.has(newsletter.error.code)
        ? ok(false)
        : newsletter
    }
    if (!issueSlug) return ok(true)
    const issue = await CrmNewsletterArchiveRepository.findSentIssue(
      newsletter.value.row.id,
      issueSlug,
    )
    if (!issue.ok) {
      return ARCHIVE_NOT_FOUND.has(issue.error.code) ? ok(false) : issue
    }
    return ok(Boolean(issue.value.webHtml?.trim()))
  },

  /** Archive home: the newsletter and one page of its SENT issues. A page
   * past the end is empty (the page shows a link back to the first). */
  async getArchive(
    workspaceSlug: string,
    newsletterSlug: string,
    page: number,
  ): Promise<Result<PublicNewsletterArchivePageDTO>> {
    const newsletter = await loadPublicNewsletter(workspaceSlug, newsletterSlug)
    if (!newsletter.ok) return newsletter

    const pageSize = NEWSLETTER_ARCHIVE_PAGE_SIZE
    const issues = await CrmNewsletterArchiveRepository.listSentIssues(
      newsletter.value.row.id,
      { skip: (page - 1) * pageSize, take: pageSize },
    )
    if (!issues.ok) return issues

    const { items, total } = issues.value
    return ok({
      ...newsletter.value.base,
      issues: items.map(toPublicIssueSummary),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    })
  },

  /** Web version of one SENT issue, with its neighbours. An issue sent
   * before the web HTML existed has nothing to show and 404s. */
  async getIssue(
    workspaceSlug: string,
    newsletterSlug: string,
    issueSlug: string,
  ): Promise<Result<PublicNewsletterIssuePageDTO>> {
    const newsletter = await loadPublicNewsletter(workspaceSlug, newsletterSlug)
    if (!newsletter.ok) return newsletter
    const newsletterId = newsletter.value.row.id

    const issue = await CrmNewsletterArchiveRepository.findSentIssue(
      newsletterId,
      issueSlug,
    )
    if (!issue.ok) return issue
    const webHtml = issue.value.webHtml?.trim()
    if (!webHtml) {
      logger.warn('crm.newsletter.archive.issue_without_web_html', {
        newsletterId,
        issueSlug,
      })
      return err(crmNewsletterNotFound())
    }

    const summary = toPublicIssueSummary(issue.value)
    const adjacent = await CrmNewsletterArchiveRepository.findAdjacentIssues(
      newsletterId,
      summary.number,
    )
    if (!adjacent.ok) return adjacent

    const link = (row: typeof adjacent.value.previous) => {
      if (!row) return null
      const { number, subject, slug } = toPublicIssueSummary(row)
      return { number, subject, slug }
    }

    return ok({
      ...newsletter.value.base,
      issue: { ...summary, preheader: issue.value.preheader, webHtml },
      previous: link(adjacent.value.previous),
      next: link(adjacent.value.next),
    })
  },

  /** RSS 2.0: the newsletter and its last 50 SENT issues. */
  async getFeed(
    workspaceSlug: string,
    newsletterSlug: string,
  ): Promise<Result<PublicNewsletterFeedDTO>> {
    const newsletter = await loadPublicNewsletter(workspaceSlug, newsletterSlug)
    if (!newsletter.ok) return newsletter

    const issues = await CrmNewsletterArchiveRepository.listSentIssues(
      newsletter.value.row.id,
      { skip: 0, take: NEWSLETTER_RSS_LIMIT },
    )
    if (!issues.ok) return issues

    return ok({
      ...newsletter.value.base,
      issues: issues.value.items.map(toPublicIssueSummary),
    })
  },

  /**
   * Newsletters the `site.newsletter-*` elements of a published page point
   * to, by id (public: no session). With the CRM module off the elements
   * render nothing, so the answer is empty instead of an error.
   */
  async siteNewsletters(
    workspaceId: string,
    ids: string[],
  ): Promise<Result<Record<string, SiteLiveNewsletter>>> {
    if (ids.length === 0) return ok({})
    const enabled = await assertModuleEnabled(workspaceId, 'CRM')
    if (!enabled.ok) {
      return enabled.error.code === 'MODULE_DISABLED' ? ok({}) : enabled
    }

    const rows = await CrmNewsletterArchiveRepository.listForSites(
      workspaceId,
      { ids, issuesPerNewsletter: NEWSLETTER_SITE_ISSUES_MAX },
    )
    if (!rows.ok) return rows

    const byId: Record<string, SiteLiveNewsletter> = {}
    for (const row of rows.value) {
      const { id, ...live } = toSiteNewsletterOption(row, BETTER_AUTH_URL)
      byId[id] = live
    }
    return ok(byId)
  },

  /** Newsletter picker of the Sites editor (needs the Sites VIEW right). */
  async listForSiteEditor(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SiteNewsletterOptionDTO[]>> {
    const allowed = await assertSitesPermission(actorId, workspaceId, 'VIEW')
    if (!allowed.ok) return allowed

    const rows = await CrmNewsletterArchiveRepository.listForSites(
      workspaceId,
      { issuesPerNewsletter: NEWSLETTER_SITE_ISSUES_MAX },
    )
    if (!rows.ok) return rows
    return ok(
      rows.value.map((row) => toSiteNewsletterOption(row, BETTER_AUTH_URL)),
    )
  },
}
