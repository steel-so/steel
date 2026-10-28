import type { Prisma } from '@prisma/client'
import { crmNewsletterIssueNotFound, crmNewsletterNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Read-only queries of the public newsletter archive (slice nl-archive).
 * Only what may be shown to anyone: ACTIVE newsletters with the archive on,
 * of ACTIVE workspaces, and their SENT issues. No business rule besides
 * that visibility filter lives here; the CRM module gate is in the service.
 */

const archiveNewsletterSelect = {
  id: true,
  workspaceId: true,
  name: true,
  slug: true,
  description: true,
  cadenceLabel: true,
  doubleOptIn: true,
  archiveEnabled: true,
  workspace: {
    select: {
      name: true,
      slug: true,
      crmEmailBrand: { select: { logoUrl: true, primaryColor: true } },
    },
  },
} satisfies Prisma.CrmNewsletterSelect

export type ArchiveNewsletterRow = Prisma.CrmNewsletterGetPayload<{
  select: typeof archiveNewsletterSelect
}>

const issueSummarySelect = {
  number: true,
  subject: true,
  slug: true,
  excerpt: true,
  sentAt: true,
} satisfies Prisma.CrmNewsletterIssueSelect

export type ArchiveIssueSummaryRow = Prisma.CrmNewsletterIssueGetPayload<{
  select: typeof issueSummarySelect
}>

export type ArchiveIssueRow = ArchiveIssueSummaryRow & {
  preheader: string | null
  webHtml: string | null
}

export type SiteNewsletterRow = ArchiveNewsletterRow & {
  issues: ArchiveIssueSummaryRow[]
}

/** SENT issues that have what the archive shows (number and date). */
const sentIssueWhere = (newsletterId: string) =>
  ({
    newsletterId,
    status: 'SENT',
    deletedAt: null,
    number: { not: null },
    sentAt: { not: null },
  }) satisfies Prisma.CrmNewsletterIssueWhereInput

const newestFirst = [
  { sentAt: 'desc' },
  { number: 'desc' },
] satisfies Prisma.CrmNewsletterIssueOrderByWithRelationInput[]

export const CrmNewsletterArchiveRepository = {
  /** The newsletter behind `/n/<ws>/<newsletter>`, or NOT_FOUND when it
   * does not exist, is archived or deleted, has the archive off, or its
   * workspace is not ACTIVE. */
  async findPublicNewsletter(
    workspaceSlug: string,
    newsletterSlug: string,
  ): Promise<Result<ArchiveNewsletterRow>> {
    try {
      const newsletter = await prisma.crmNewsletter.findFirst({
        where: {
          slug: newsletterSlug,
          status: 'ACTIVE',
          archiveEnabled: true,
          deletedAt: null,
          workspace: { slug: workspaceSlug, status: 'ACTIVE' },
        },
        select: archiveNewsletterSelect,
      })
      if (!newsletter) return err(crmNewsletterNotFound())
      return ok(newsletter)
    } catch (error) {
      return err(dbError('Failed to find the public newsletter', error))
    }
  },

  /** One page of SENT issues, newest first, and the total. */
  async listSentIssues(
    newsletterId: string,
    options: { skip: number; take: number },
  ): Promise<Result<{ items: ArchiveIssueSummaryRow[]; total: number }>> {
    try {
      const where = sentIssueWhere(newsletterId)
      const [items, total] = await prisma.$transaction([
        prisma.crmNewsletterIssue.findMany({
          where,
          select: issueSummarySelect,
          orderBy: newestFirst,
          skip: options.skip,
          take: options.take,
        }),
        prisma.crmNewsletterIssue.count({ where }),
      ])
      return ok({ items, total })
    } catch (error) {
      return err(dbError('Failed to list the sent newsletter issues', error))
    }
  },

  /** A SENT issue by slug (with its web HTML), or ISSUE_NOT_FOUND. */
  async findSentIssue(
    newsletterId: string,
    issueSlug: string,
  ): Promise<Result<ArchiveIssueRow>> {
    try {
      const issue = await prisma.crmNewsletterIssue.findFirst({
        where: { ...sentIssueWhere(newsletterId), slug: issueSlug },
        select: { ...issueSummarySelect, preheader: true, webHtml: true },
      })
      if (!issue) return err(crmNewsletterIssueNotFound())
      return ok(issue)
    } catch (error) {
      return err(dbError('Failed to find the sent newsletter issue', error))
    }
  },

  /** The SENT issues right before and after an issue number. */
  async findAdjacentIssues(
    newsletterId: string,
    number: number,
  ): Promise<
    Result<{
      previous: ArchiveIssueSummaryRow | null
      next: ArchiveIssueSummaryRow | null
    }>
  > {
    try {
      const where = sentIssueWhere(newsletterId)
      const [previous, next] = await prisma.$transaction([
        prisma.crmNewsletterIssue.findFirst({
          where: { ...where, number: { lt: number } },
          select: issueSummarySelect,
          orderBy: { number: 'desc' },
        }),
        prisma.crmNewsletterIssue.findFirst({
          where: { ...where, number: { gt: number } },
          select: issueSummarySelect,
          orderBy: { number: 'asc' },
        }),
      ])
      return ok({ previous, next })
    } catch (error) {
      return err(
        dbError('Failed to find the adjacent newsletter issues', error),
      )
    }
  },

  /**
   * ACTIVE newsletters of a workspace with their latest SENT issues — the
   * Sites elements (runtime: the ids on the page; editor: every one).
   */
  async listForSites(
    workspaceId: string,
    options: { ids?: string[]; issuesPerNewsletter: number },
  ): Promise<Result<SiteNewsletterRow[]>> {
    try {
      const newsletters = await prisma.crmNewsletter.findMany({
        where: {
          workspaceId,
          status: 'ACTIVE',
          deletedAt: null,
          ...(options.ids ? { id: { in: options.ids } } : {}),
        },
        select: {
          ...archiveNewsletterSelect,
          issues: {
            where: {
              status: 'SENT',
              deletedAt: null,
              number: { not: null },
              sentAt: { not: null },
            },
            select: issueSummarySelect,
            orderBy: newestFirst,
            take: options.issuesPerNewsletter,
          },
        },
        orderBy: { name: 'asc' },
      })
      return ok(newsletters)
    } catch (error) {
      return err(dbError('Failed to list newsletters for sites', error))
    }
  },
}
