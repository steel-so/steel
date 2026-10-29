import type {
  CrmNewsletter,
  CrmNewsletterIssue,
  CrmNewsletterIssueStatus,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import {
  segmentIdsSql,
  segmentSubscriberIds,
} from './crm-newsletter-segment.repository'
import { dbError } from './db-error'

/**
 * Newsletter issues (ADR 0054, slice nl-issues): CRUD, the conditional
 * status transitions of the send flow and the audience snapshot. Tenant
 * scope is always explicit (`workspaceId` + `newsletterId`); the worker uses
 * the `*Unscoped` reads.
 */

export type NewsletterWithWorkspace = CrmNewsletter & {
  workspace: { slug: string; name: string }
}

export type IssueWithNewsletter = CrmNewsletterIssue & {
  newsletter: NewsletterWithWorkspace
}

const NEWSLETTER_INCLUDE = {
  workspace: { select: { slug: true, name: true } },
} as const

/** Statuses whose content may still change. */
export const EDITABLE_ISSUE_STATUSES: CrmNewsletterIssueStatus[] = [
  'DRAFT',
  'SCHEDULED',
]

export type CreateIssueData = {
  workspaceId: string
  newsletterId: string
  subject: string
  preheader: string | null
  slug: string
  builderDocument: Prisma.InputJsonValue
  createdById: string
}

export type UpdateIssueData = {
  subject?: string
  preheader?: string | null
  slug?: string
  builderDocument?: Prisma.InputJsonValue
  updatedById: string
}

export const CrmNewsletterIssueRepository = {
  async findNewsletter(
    workspaceId: string,
    newsletterId: string,
  ): Promise<Result<NewsletterWithWorkspace | null>> {
    try {
      const newsletter = await prisma.crmNewsletter.findFirst({
        where: { id: newsletterId, workspaceId, deletedAt: null },
        include: NEWSLETTER_INCLUDE,
      })
      return ok(newsletter)
    } catch (error) {
      return err(dbError('Failed to find CRM newsletter', error))
    }
  },

  async list(
    workspaceId: string,
    newsletterId: string,
    query: {
      page: number
      pageSize: number
      status?: CrmNewsletterIssueStatus
    },
  ): Promise<Result<{ items: CrmNewsletterIssue[]; total: number }>> {
    const where: Prisma.CrmNewsletterIssueWhereInput = {
      workspaceId,
      newsletterId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
    }
    try {
      const [items, total] = await prisma.$transaction([
        prisma.crmNewsletterIssue.findMany({
          where,
          // Sent issues by number (newest first), drafts on top by update.
          orderBy: [
            { number: { sort: 'desc', nulls: 'first' } },
            { updatedAt: 'desc' },
          ],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.crmNewsletterIssue.count({ where }),
      ])
      return ok({ items, total })
    } catch (error) {
      return err(dbError('Failed to list CRM newsletter issues', error))
    }
  },

  async findById(
    workspaceId: string,
    newsletterId: string,
    issueId: string,
  ): Promise<Result<CrmNewsletterIssue | null>> {
    try {
      const issue = await prisma.crmNewsletterIssue.findFirst({
        where: { id: issueId, workspaceId, newsletterId, deletedAt: null },
      })
      return ok(issue)
    } catch (error) {
      return err(dbError('Failed to find CRM newsletter issue', error))
    }
  },

  async findByIdUnscoped(
    issueId: string,
  ): Promise<Result<IssueWithNewsletter | null>> {
    try {
      const issue = await prisma.crmNewsletterIssue.findFirst({
        where: { id: issueId, deletedAt: null },
        include: { newsletter: { include: NEWSLETTER_INCLUDE } },
      })
      return ok(issue)
    } catch (error) {
      return err(dbError('Failed to find CRM newsletter issue', error))
    }
  },

  async slugTaken(
    newsletterId: string,
    slug: string,
    exceptId?: string,
  ): Promise<Result<boolean>> {
    try {
      const found = await prisma.crmNewsletterIssue.findFirst({
        where: {
          newsletterId,
          slug,
          ...(exceptId ? { id: { not: exceptId } } : {}),
        },
        select: { id: true },
      })
      return ok(found !== null)
    } catch (error) {
      return err(dbError('Failed to check CRM newsletter issue slug', error))
    }
  },

  async create(data: CreateIssueData): Promise<Result<CrmNewsletterIssue>> {
    try {
      const issue = await prisma.crmNewsletterIssue.create({ data })
      return ok(issue)
    } catch (error) {
      return err(dbError('Failed to create CRM newsletter issue', error))
    }
  },

  /** Updates an issue still in DRAFT/SCHEDULED; `null` when it left them. */
  async updateEditable(
    issueId: string,
    data: UpdateIssueData,
  ): Promise<Result<CrmNewsletterIssue | null>> {
    try {
      const updated = await prisma.crmNewsletterIssue.updateMany({
        where: {
          id: issueId,
          deletedAt: null,
          status: { in: EDITABLE_ISSUE_STATUSES },
        },
        data,
      })
      if (updated.count === 0) return ok(null)
      const issue = await prisma.crmNewsletterIssue.findUnique({
        where: { id: issueId },
      })
      return ok(issue)
    } catch (error) {
      return err(dbError('Failed to update CRM newsletter issue', error))
    }
  },

  /** Soft-deletes a DRAFT; `false` when the issue is no longer a draft. */
  async softDeleteDraft(issueId: string, now: Date): Promise<Result<boolean>> {
    try {
      const updated = await prisma.crmNewsletterIssue.updateMany({
        where: { id: issueId, deletedAt: null, status: 'DRAFT' },
        data: { deletedAt: now },
      })
      return ok(updated.count === 1)
    } catch (error) {
      return err(dbError('Failed to delete CRM newsletter issue', error))
    }
  },

  /**
   * Conditional status change: applies `data` only while the issue is in
   * one of `from`, so concurrent callers cannot both win. `null` = lost.
   */
  async transition(
    issueId: string,
    from: CrmNewsletterIssueStatus[],
    data: Prisma.CrmNewsletterIssueUpdateManyMutationInput,
  ): Promise<Result<CrmNewsletterIssue | null>> {
    try {
      const updated = await prisma.crmNewsletterIssue.updateMany({
        where: { id: issueId, deletedAt: null, status: { in: from } },
        data,
      })
      if (updated.count === 0) return ok(null)
      const issue = await prisma.crmNewsletterIssue.findUnique({
        where: { id: issueId },
      })
      return ok(issue)
    } catch (error) {
      return err(dbError('Failed to transition CRM newsletter issue', error))
    }
  },

  /**
   * ACTIVE subscribers of the newsletter that are not in the workspace-wide
   * opt-out — the audience a send would snapshot right now.
   */
  async countAudience(
    workspaceId: string,
    newsletterId: string,
    /** nl2-segments: the issue's compiled segment (omitted = everyone). */
    segmentWhere?: Prisma.CrmNewsletterSubscriberWhereInput,
  ): Promise<Result<number>> {
    try {
      const ids = segmentWhere
        ? await segmentSubscriberIds(
            prisma,
            workspaceId,
            newsletterId,
            segmentWhere,
          )
        : null
      const rows = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count
        FROM crm_newsletter_subscribers s
        WHERE s.newsletter_id = ${newsletterId}
          AND s.workspace_id = ${workspaceId}
          AND s.status = 'ACTIVE'
          AND NOT EXISTS (
            SELECT 1 FROM crm_email_opt_outs o
            WHERE o.workspace_id = s.workspace_id AND o.email = s.email
          )
          ${segmentIdsSql(ids)}`
      return ok(Number(rows[0].count))
    } catch (error) {
      return err(dbError('Failed to count CRM newsletter audience', error))
    }
  },

  /**
   * Start of sending, in one transaction: DRAFT/SCHEDULED → SENDING, the
   * edition number (max + 1, serialized per newsletter by an advisory
   * lock), the audience snapshot and the web version. `null` when the issue
   * already left DRAFT/SCHEDULED (someone else started or canceled it).
   */
  async startSending(
    issueId: string,
    input: {
      webHtml: string
      excerpt: string
      now: Date
      /** nl2-segments: the issue's compiled segment (omitted = everyone). */
      segmentWhere?: Prisma.CrmNewsletterSubscriberWhereInput
    },
  ): Promise<Result<{ issue: CrmNewsletterIssue; recipients: number } | null>> {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const current = await tx.crmNewsletterIssue.findFirst({
          where: { id: issueId, deletedAt: null },
          select: { newsletterId: true, workspaceId: true },
        })
        if (!current) return null
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crm-newsletter-number:${current.newsletterId}`}))`
        const max = await tx.crmNewsletterIssue.aggregate({
          where: { newsletterId: current.newsletterId },
          _max: { number: true },
        })
        const started = await tx.crmNewsletterIssue.updateMany({
          where: {
            id: issueId,
            deletedAt: null,
            status: { in: EDITABLE_ISSUE_STATUSES },
          },
          data: {
            status: 'SENDING',
            number: (max._max.number ?? 0) + 1,
            sendingStartedAt: input.now,
            webHtml: input.webHtml,
            excerpt: input.excerpt,
            failureReason: null,
          },
        })
        if (started.count === 0) return null
        const ids = input.segmentWhere
          ? await segmentSubscriberIds(
              tx,
              current.workspaceId,
              current.newsletterId,
              input.segmentWhere,
            )
          : null
        const recipients = await tx.$executeRaw`
          INSERT INTO crm_newsletter_issue_recipients
            (id, issue_id, workspace_id, subscriber_id, email, name, status, created_at, updated_at)
          SELECT gen_random_uuid()::text, ${issueId}, s.workspace_id, s.id, s.email, s.name,
                 'PENDING'::"CrmNewsletterDeliveryStatus", ${input.now}, ${input.now}
          FROM crm_newsletter_subscribers s
          WHERE s.newsletter_id = ${current.newsletterId}
            AND s.workspace_id = ${current.workspaceId}
            AND s.status = 'ACTIVE'
            AND NOT EXISTS (
              SELECT 1 FROM crm_email_opt_outs o
              WHERE o.workspace_id = s.workspace_id AND o.email = s.email
            )
            ${segmentIdsSql(ids)}
          ON CONFLICT (issue_id, subscriber_id) DO NOTHING`
        const issue = await tx.crmNewsletterIssue.findUniqueOrThrow({
          where: { id: issueId },
        })
        return { issue, recipients }
      })
      return ok(result)
    } catch (error) {
      return err(dbError('Failed to start CRM newsletter issue send', error))
    }
  },

  /** SCHEDULED issues whose time arrived. */
  async listDue(now: Date, limit = 50): Promise<Result<CrmNewsletterIssue[]>> {
    try {
      const issues = await prisma.crmNewsletterIssue.findMany({
        where: {
          status: 'SCHEDULED',
          deletedAt: null,
          scheduledAt: { lte: now },
        },
        orderBy: { scheduledAt: 'asc' },
        take: limit,
      })
      return ok(issues)
    } catch (error) {
      return err(dbError('Failed to list due CRM newsletter issues', error))
    }
  },

  async listSending(limit = 100): Promise<Result<CrmNewsletterIssue[]>> {
    try {
      const issues = await prisma.crmNewsletterIssue.findMany({
        where: { status: 'SENDING', deletedAt: null },
        orderBy: { sendingStartedAt: 'asc' },
        take: limit,
      })
      return ok(issues)
    } catch (error) {
      return err(dbError('Failed to list sending CRM newsletter issues', error))
    }
  },

  /** The last sent issues of a newsletter (newest first). */
  async listLastSent(
    workspaceId: string,
    newsletterId: string,
    limit: number,
  ): Promise<Result<CrmNewsletterIssue[]>> {
    try {
      const issues = await prisma.crmNewsletterIssue.findMany({
        where: {
          workspaceId,
          newsletterId,
          deletedAt: null,
          status: 'SENT',
        },
        orderBy: { sentAt: 'desc' },
        take: limit,
      })
      return ok(issues)
    } catch (error) {
      return err(dbError('Failed to list sent CRM newsletter issues', error))
    }
  },
}
