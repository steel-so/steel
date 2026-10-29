import { type CrmNewsletterIssueRecipient, Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type {
  CrmNewsletterIssueLinkStatDTO,
  CrmNewsletterIssueStatsDTO,
  CrmNewsletterRecipientFilter,
} from '@/src/schemas/crm-newsletter-issue.schema'
import { dbError } from './db-error'

/**
 * Per-recipient delivery rows of a newsletter issue (ADR 0054): the batch
 * claim of the worker (PENDING → SENDING, `FOR UPDATE SKIP LOCKED`, so two
 * workers never take the same row), the outcome of each send, the Resend
 * webhook marks, the report counters and the subscriber side effects
 * (last sent/opened/clicked, bounce, complaint).
 */

export type ClaimedRecipient = Pick<
  CrmNewsletterIssueRecipient,
  'id' | 'subscriberId' | 'email' | 'name'
> & {
  personId: string | null
  subscriberStatus: string
  /** Subject A/B test (nl2-digest-ai): "A"/"B" in the test share. */
  abVariant?: string | null
}

export type RecipientWithIssue = CrmNewsletterIssueRecipient & {
  issue: { id: string; workspaceId: string; newsletterId: string }
}

/** First-time marks set by the webhook. */
export type RecipientMark =
  | 'deliveredAt'
  | 'openedAt'
  | 'clickedAt'
  | 'bouncedAt'
  | 'complainedAt'

const EMPTY_STATS: CrmNewsletterIssueStatsDTO = {
  recipients: 0,
  sent: 0,
  skipped: 0,
  failed: 0,
  delivered: 0,
  opened: 0,
  clicked: 0,
  bounced: 0,
  complained: 0,
  unsubscribed: 0,
}

type StatsRow = { issue_id: string } & Record<
  keyof CrmNewsletterIssueStatsDTO,
  bigint
>

function filterWhere(
  filter: CrmNewsletterRecipientFilter,
): Prisma.CrmNewsletterIssueRecipientWhereInput {
  switch (filter) {
    case 'delivered':
      return { deliveredAt: { not: null } }
    case 'opened':
      return { openedAt: { not: null } }
    case 'not_opened':
      return { status: 'SENT', openedAt: null }
    case 'clicked':
      return { clickedAt: { not: null } }
    case 'bounced':
      return { bouncedAt: { not: null } }
    case 'complained':
      return { complainedAt: { not: null } }
    case 'unsubscribed':
      return { unsubscribedAt: { not: null } }
    case 'failed':
      return { status: 'FAILED' }
    case 'skipped':
      return { status: 'SKIPPED' }
    default:
      return {}
  }
}

export const CrmNewsletterDeliveryRepository = {
  /** Claims up to `limit` PENDING rows of the issue (→ SENDING). */
  async claimBatch(
    issueId: string,
    limit: number,
  ): Promise<Result<ClaimedRecipient[]>> {
    try {
      const claimed = await prisma.$queryRaw<{ id: string }[]>`
        UPDATE crm_newsletter_issue_recipients
        SET status = 'SENDING'::"CrmNewsletterDeliveryStatus", updated_at = NOW()
        WHERE id IN (
          SELECT id FROM crm_newsletter_issue_recipients
          WHERE issue_id = ${issueId} AND status = 'PENDING'::"CrmNewsletterDeliveryStatus"
            AND ab_held = false
          ORDER BY created_at, id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id`
      if (claimed.length === 0) return ok([])
      const rows = await prisma.crmNewsletterIssueRecipient.findMany({
        where: { id: { in: claimed.map((row) => row.id) } },
        select: {
          id: true,
          subscriberId: true,
          email: true,
          name: true,
          abVariant: true,
          subscriber: { select: { personId: true, status: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      return ok(
        rows.map(({ subscriber, ...row }) => ({
          ...row,
          personId: subscriber.personId,
          subscriberStatus: subscriber.status,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to claim CRM newsletter recipients', error))
    }
  },

  /** Records the provider ids and stamps the subscribers' `lastSentAt`. */
  async markSent(
    sent: { id: string; subscriberId: string; providerMessageId: string }[],
    now: Date,
  ): Promise<Result<void>> {
    if (sent.length === 0) return ok(undefined)
    try {
      await prisma.$transaction([
        ...sent.map((row) =>
          prisma.crmNewsletterIssueRecipient.updateMany({
            where: { id: row.id, status: 'SENDING' },
            data: {
              status: 'SENT',
              providerMessageId: row.providerMessageId,
              sentAt: now,
              error: null,
            },
          }),
        ),
        prisma.crmNewsletterSubscriber.updateMany({
          where: { id: { in: sent.map((row) => row.subscriberId) } },
          data: { lastSentAt: now },
        }),
      ])
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to record CRM newsletter sends', error))
    }
  },

  async markFailed(ids: string[], error: string): Promise<Result<void>> {
    if (ids.length === 0) return ok(undefined)
    try {
      await prisma.crmNewsletterIssueRecipient.updateMany({
        where: { id: { in: ids }, status: 'SENDING' },
        data: { status: 'FAILED', error: error.slice(0, 500) },
      })
      return ok(undefined)
    } catch (cause) {
      return err(dbError('Failed to mark CRM newsletter recipients', cause))
    }
  },

  /** SENDING/PENDING rows excluded at send time (`skipReason`). */
  async markSkipped(ids: string[], reason: string): Promise<Result<void>> {
    if (ids.length === 0) return ok(undefined)
    try {
      await prisma.crmNewsletterIssueRecipient.updateMany({
        where: { id: { in: ids }, status: { in: ['PENDING', 'SENDING'] } },
        data: { status: 'SKIPPED', skipReason: reason },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to skip CRM newsletter recipients', error))
    }
  },

  /** "Parar envio": every PENDING row of the issue becomes SKIPPED. */
  async skipPending(issueId: string, reason: string): Promise<Result<number>> {
    try {
      const updated = await prisma.crmNewsletterIssueRecipient.updateMany({
        where: { issueId, status: 'PENDING' },
        data: { status: 'SKIPPED', skipReason: reason },
      })
      return ok(updated.count)
    } catch (error) {
      return err(dbError('Failed to stop CRM newsletter recipients', error))
    }
  },

  /** Gives claimed rows back (transient provider failure). */
  async release(ids: string[]): Promise<Result<void>> {
    if (ids.length === 0) return ok(undefined)
    try {
      await prisma.crmNewsletterIssueRecipient.updateMany({
        where: { id: { in: ids }, status: 'SENDING' },
        data: { status: 'PENDING' },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to release CRM newsletter recipients', error))
    }
  },

  /** Rows left in SENDING since before `before` (worker died) → PENDING. */
  async releaseStuck(before: Date): Promise<Result<number>> {
    try {
      const updated = await prisma.crmNewsletterIssueRecipient.updateMany({
        where: { status: 'SENDING', updatedAt: { lt: before } },
        data: { status: 'PENDING' },
      })
      return ok(updated.count)
    } catch (error) {
      return err(dbError('Failed to release stuck CRM newsletter rows', error))
    }
  },

  async countOpen(issueId: string): Promise<Result<number>> {
    try {
      const count = await prisma.crmNewsletterIssueRecipient.count({
        where: { issueId, status: { in: ['PENDING', 'SENDING'] } },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to count open CRM newsletter rows', error))
    }
  },

  /** Report counters of several issues at once (missing = no rows). */
  async statsFor(
    issueIds: string[],
  ): Promise<Result<Map<string, CrmNewsletterIssueStatsDTO>>> {
    const stats = new Map<string, CrmNewsletterIssueStatsDTO>()
    if (issueIds.length === 0) return ok(stats)
    try {
      const rows = await prisma.$queryRaw<StatsRow[]>`
        SELECT issue_id,
          COUNT(*)::bigint AS recipients,
          COUNT(*) FILTER (WHERE status = 'SENT')::bigint AS sent,
          COUNT(*) FILTER (WHERE status = 'SKIPPED')::bigint AS skipped,
          COUNT(*) FILTER (WHERE status = 'FAILED')::bigint AS failed,
          COUNT(delivered_at)::bigint AS delivered,
          COUNT(opened_at)::bigint AS opened,
          COUNT(clicked_at)::bigint AS clicked,
          COUNT(bounced_at)::bigint AS bounced,
          COUNT(complained_at)::bigint AS complained,
          COUNT(unsubscribed_at)::bigint AS unsubscribed
        FROM crm_newsletter_issue_recipients
        WHERE issue_id IN (${Prisma.join(issueIds)})
        GROUP BY issue_id`
      for (const row of rows) {
        const entry = { ...EMPTY_STATS }
        for (const key of Object.keys(EMPTY_STATS) as Array<
          keyof CrmNewsletterIssueStatsDTO
        >) {
          entry[key] = Number(row[key])
        }
        stats.set(row.issue_id, entry)
      }
      return ok(stats)
    } catch (error) {
      return err(dbError('Failed to compute CRM newsletter stats', error))
    }
  },

  /** Clicks per URL of an issue (most clicked first). */
  async linkStats(
    issueId: string,
  ): Promise<Result<CrmNewsletterIssueLinkStatDTO[]>> {
    try {
      const rows = await prisma.$queryRaw<
        { url: string; clicks: bigint; unique_clickers: bigint }[]
      >`
        SELECT url, COUNT(*)::bigint AS clicks,
               COUNT(DISTINCT recipient_id)::bigint AS unique_clickers
        FROM crm_newsletter_link_clicks
        WHERE issue_id = ${issueId}
        GROUP BY url
        ORDER BY clicks DESC, url ASC
        LIMIT 200`
      return ok(
        rows.map((row) => ({
          url: row.url,
          clicks: Number(row.clicks),
          uniqueClickers: Number(row.unique_clickers),
        })),
      )
    } catch (error) {
      return err(dbError('Failed to compute CRM newsletter link stats', error))
    }
  },

  async listRecipients(
    issueId: string,
    query: {
      page: number
      pageSize: number
      filter: CrmNewsletterRecipientFilter
      search?: string
    },
  ): Promise<Result<{ items: CrmNewsletterIssueRecipient[]; total: number }>> {
    const where: Prisma.CrmNewsletterIssueRecipientWhereInput = {
      issueId,
      ...filterWhere(query.filter),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    }
    try {
      const [items, total] = await prisma.$transaction([
        prisma.crmNewsletterIssueRecipient.findMany({
          where,
          orderBy: [{ email: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.crmNewsletterIssueRecipient.count({ where }),
      ])
      return ok({ items, total })
    } catch (error) {
      return err(dbError('Failed to list CRM newsletter recipients', error))
    }
  },

  // ─── Webhook ──────────────────────────────────────────────────────────────

  async findByProviderMessageId(
    providerMessageId: string,
  ): Promise<Result<RecipientWithIssue | null>> {
    try {
      const recipient = await prisma.crmNewsletterIssueRecipient.findUnique({
        where: { providerMessageId },
        include: {
          issue: {
            select: { id: true, workspaceId: true, newsletterId: true },
          },
        },
      })
      return ok(recipient)
    } catch (error) {
      return err(dbError('Failed to find CRM newsletter recipient', error))
    }
  },

  /** Sets `field` only the first time; `true` when it changed. */
  async markFirst(
    recipientId: string,
    field: RecipientMark,
    at: Date,
  ): Promise<Result<boolean>> {
    try {
      const updated = await prisma.crmNewsletterIssueRecipient.updateMany({
        where: { id: recipientId, [field]: null },
        data: { [field]: at },
      })
      return ok(updated.count === 1)
    } catch (error) {
      return err(dbError('Failed to mark CRM newsletter recipient', error))
    }
  },

  async recordClick(input: {
    issueId: string
    recipientId: string
    url: string
    clickedAt: Date
  }): Promise<Result<void>> {
    try {
      await prisma.crmNewsletterLinkClick.create({ data: input })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to record CRM newsletter click', error))
    }
  },

  async touchSubscriber(
    subscriberId: string,
    field: 'lastOpenedAt' | 'lastClickedAt',
    at: Date,
  ): Promise<Result<void>> {
    try {
      await prisma.crmNewsletterSubscriber.updateMany({
        where: { id: subscriberId },
        data: { [field]: at },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to update CRM newsletter subscriber', error))
    }
  },

  /** Hard bounce: the address is BOUNCED in every newsletter of the workspace. */
  async bounceEverywhere(
    workspaceId: string,
    email: string,
    at: Date,
  ): Promise<Result<number>> {
    try {
      const updated = await prisma.crmNewsletterSubscriber.updateMany({
        where: {
          workspaceId,
          email: email.trim().toLowerCase(),
          status: { not: 'BOUNCED' },
        },
        data: { status: 'BOUNCED', bouncedAt: at },
      })
      return ok(updated.count)
    } catch (error) {
      return err(dbError('Failed to bounce CRM newsletter subscriber', error))
    }
  },

  /** Spam complaint: the subscriber leaves that newsletter. */
  async complain(subscriberId: string, at: Date): Promise<Result<void>> {
    try {
      await prisma.crmNewsletterSubscriber.updateMany({
        where: { id: subscriberId },
        data: { status: 'COMPLAINED', complainedAt: at },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to record CRM newsletter complaint', error))
    }
  },

  /** E-mails (lower-case) of `emails` in the workspace-wide opt-out. */
  async optedOut(
    workspaceId: string,
    emails: string[],
  ): Promise<Result<Set<string>>> {
    if (emails.length === 0) return ok(new Set())
    try {
      const rows = await prisma.crmEmailOptOut.findMany({
        where: {
          workspaceId,
          email: { in: emails.map((email) => email.toLowerCase()) },
        },
        select: { email: true },
      })
      return ok(new Set(rows.map((row) => row.email)))
    } catch (error) {
      return err(dbError('Failed to read CRM e-mail opt-outs', error))
    }
  },
}
