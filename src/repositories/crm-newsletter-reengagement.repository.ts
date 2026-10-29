import {
  type CrmNewsletterReengagement,
  type CrmNewsletterReengagementSettings,
  type CrmNewsletterReengagementStatus,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import {
  CRM_NEWSLETTER_INACTIVE_REASON,
  type CrmNewsletterReengagementTotalsDTO,
} from '@/src/schemas/crm-newsletter-automation.schema'
import type { NewsletterWithWorkspace } from './crm-newsletter-issue.repository'
import { dbError } from './db-error'

/**
 * Re-engagement of inactive newsletter subscribers (slice nl2-automation):
 * per-newsletter settings, the candidate query (shared by the preview and
 * the monthly run), the attempt rows (one per subscriber × month) and the
 * end of the grace period.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export type ReengagementSettingsWithNewsletter =
  CrmNewsletterReengagementSettings & { newsletter: NewsletterWithWorkspace }

export type ClaimedReengagement = Pick<
  CrmNewsletterReengagement,
  'id' | 'subscriberId' | 'email'
> & { name: string | null; personId: string | null }

/** WAITING attempt whose grace period is over. */
export type DueReengagement = {
  id: string
  newsletterId: string
  workspaceId: string
  subscriberId: string
  sentAt: Date
  openedAt: Date | null
  clickedAt: Date | null
  reengagedAt: Date | null
  subscriberStatus: string
  lastOpenedAt: Date | null
  lastClickedAt: Date | null
  action: 'UNSUBSCRIBE' | 'FLAG'
}

export type ReengagementWithContext = CrmNewsletterReengagement & {
  newsletter: { id: string; name: string; workspace: { name: string } }
  subscriber: {
    id: string
    status: string
    unsubscribeReason: string | null
  }
}

type CandidateCriteria = {
  newsletterId: string
  minIssues: number
  inactiveDays: number
  now: Date
}

/** Shared WHERE of the candidates (subscriber alias `s`). */
function candidateWhere(criteria: CandidateCriteria): Prisma.Sql {
  const since = new Date(
    criteria.now.getTime() - criteria.inactiveDays * DAY_MS,
  )
  return Prisma.sql`
    s.newsletter_id = ${criteria.newsletterId}
    AND s.status = 'ACTIVE'::"CrmNewsletterSubscriberStatus"
    AND (s.last_opened_at IS NULL OR s.last_opened_at < ${since})
    AND (s.last_clicked_at IS NULL OR s.last_clicked_at < ${since})
    AND NOT EXISTS (
      SELECT 1 FROM crm_email_opt_outs o
      WHERE o.workspace_id = s.workspace_id AND o.email = s.email
    )
    AND NOT EXISTS (
      SELECT 1 FROM crm_newsletter_reengagements r
      WHERE r.subscriber_id = s.id
        AND (r.status IN ('SENDING', 'WAITING') OR r.created_at >= ${since})
    )
    AND (
      SELECT COUNT(*) FROM crm_newsletter_issue_recipients ir
      WHERE ir.subscriber_id = s.id
        AND ir.status = 'SENT'::"CrmNewsletterDeliveryStatus"
        AND ir.sent_at >= ${since}
    ) >= ${criteria.minIssues}`
}

export const CrmNewsletterReengagementRepository = {
  // ─── Settings ───────────────────────────────────────────────────────────

  async findSettings(
    newsletterId: string,
  ): Promise<Result<CrmNewsletterReengagementSettings | null>> {
    try {
      const settings =
        await prisma.crmNewsletterReengagementSettings.findUnique({
          where: { newsletterId },
        })
      return ok(settings)
    } catch (error) {
      return err(dbError('Failed to read CRM newsletter re-engagement', error))
    }
  },

  async upsertSettings(
    newsletterId: string,
    workspaceId: string,
    data: Omit<
      Prisma.CrmNewsletterReengagementSettingsUncheckedCreateInput,
      'newsletterId' | 'workspaceId'
    >,
  ): Promise<Result<CrmNewsletterReengagementSettings>> {
    try {
      const settings = await prisma.crmNewsletterReengagementSettings.upsert({
        where: { newsletterId },
        create: { ...data, newsletterId, workspaceId },
        update: data,
      })
      return ok(settings)
    } catch (error) {
      return err(dbError('Failed to save CRM newsletter re-engagement', error))
    }
  },

  /** Enabled settings of ACTIVE newsletters (monthly run). */
  async listEnabled(): Promise<Result<ReengagementSettingsWithNewsletter[]>> {
    try {
      const rows = await prisma.crmNewsletterReengagementSettings.findMany({
        where: {
          enabled: true,
          newsletter: { status: 'ACTIVE', deletedAt: null },
        },
        include: {
          newsletter: {
            include: { workspace: { select: { slug: true, name: true } } },
          },
        },
        orderBy: { newsletterId: 'asc' },
      })
      return ok(rows)
    } catch (error) {
      return err(
        dbError('Failed to list CRM newsletter re-engagement settings', error),
      )
    }
  },

  // ─── Candidates ─────────────────────────────────────────────────────────

  async countCandidates(criteria: CandidateCriteria): Promise<Result<number>> {
    try {
      const rows = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count
        FROM crm_newsletter_subscribers s
        WHERE ${candidateWhere(criteria)}`
      return ok(Number(rows[0].count))
    } catch (error) {
      return err(
        dbError(
          'Failed to count CRM newsletter re-engagement candidates',
          error,
        ),
      )
    }
  },

  /** Creates the attempts of this run (SENDING); a rerun adds nothing. */
  async claimCandidates(
    criteria: CandidateCriteria & { cycle: string; limit: number },
  ): Promise<Result<ClaimedReengagement[]>> {
    if (criteria.limit <= 0) return ok([])
    try {
      const created = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO crm_newsletter_reengagements
          (id, newsletter_id, workspace_id, subscriber_id, email, cycle,
           status, created_at, updated_at)
        SELECT gen_random_uuid()::text, s.newsletter_id, s.workspace_id, s.id,
               s.email, ${criteria.cycle},
               'SENDING'::"CrmNewsletterReengagementStatus", NOW(), NOW()
        FROM crm_newsletter_subscribers s
        WHERE ${candidateWhere(criteria)}
        ORDER BY s.created_at, s.id
        LIMIT ${criteria.limit}
        ON CONFLICT (subscriber_id, cycle) DO NOTHING
        RETURNING id`
      if (created.length === 0) return ok([])
      const rows = await prisma.crmNewsletterReengagement.findMany({
        where: { id: { in: created.map((row) => row.id) } },
        select: {
          id: true,
          subscriberId: true,
          email: true,
          subscriber: { select: { name: true, personId: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      return ok(
        rows.map(({ subscriber, ...row }) => ({
          ...row,
          name: subscriber.name,
          personId: subscriber.personId,
        })),
      )
    } catch (error) {
      return err(
        dbError('Failed to claim CRM newsletter re-engagement sends', error),
      )
    }
  },

  async markSent(
    sent: { id: string; subscriberId: string; providerMessageId: string }[],
    now: Date,
  ): Promise<Result<void>> {
    if (sent.length === 0) return ok(undefined)
    try {
      await prisma.$transaction([
        ...sent.map((row) =>
          prisma.crmNewsletterReengagement.updateMany({
            where: { id: row.id, status: 'SENDING' },
            data: {
              status: 'WAITING',
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
      return err(
        dbError('Failed to record CRM newsletter re-engagement sends', error),
      )
    }
  },

  async markFailed(ids: string[], error: string): Promise<Result<void>> {
    if (ids.length === 0) return ok(undefined)
    try {
      await prisma.crmNewsletterReengagement.updateMany({
        where: { id: { in: ids }, status: 'SENDING' },
        data: { status: 'FAILED', error: error.slice(0, 500) },
      })
      return ok(undefined)
    } catch (cause) {
      return err(
        dbError('Failed to fail CRM newsletter re-engagement sends', cause),
      )
    }
  },

  /** Attempts left in SENDING since before `before` (worker died) → FAILED. */
  async failStuck(before: Date): Promise<Result<number>> {
    try {
      const updated = await prisma.crmNewsletterReengagement.updateMany({
        where: { status: 'SENDING', updatedAt: { lt: before } },
        data: { status: 'FAILED', error: 'Envio interrompido' },
      })
      return ok(updated.count)
    } catch (error) {
      return err(
        dbError('Failed to close stuck CRM newsletter re-engagements', error),
      )
    }
  },

  // ─── Grace period ───────────────────────────────────────────────────────

  /** WAITING attempts of enabled newsletters whose grace period is over. */
  async listDue(now: Date, limit: number): Promise<Result<DueReengagement[]>> {
    try {
      const rows = await prisma.$queryRaw<
        {
          id: string
          newsletter_id: string
          workspace_id: string
          subscriber_id: string
          sent_at: Date
          opened_at: Date | null
          clicked_at: Date | null
          reengaged_at: Date | null
          subscriber_status: string
          last_opened_at: Date | null
          last_clicked_at: Date | null
          action: 'UNSUBSCRIBE' | 'FLAG'
        }[]
      >`
        SELECT r.id, r.newsletter_id, r.workspace_id, r.subscriber_id,
               r.sent_at, r.opened_at, r.clicked_at, r.reengaged_at,
               s.status::text AS subscriber_status,
               s.last_opened_at, s.last_clicked_at, st.action::text AS action
        FROM crm_newsletter_reengagements r
        JOIN crm_newsletter_reengagement_settings st
          ON st.newsletter_id = r.newsletter_id AND st.enabled
        JOIN crm_newsletter_subscribers s ON s.id = r.subscriber_id
        WHERE r.status = 'WAITING'::"CrmNewsletterReengagementStatus"
          AND r.sent_at + make_interval(days => st.grace_days) <= ${now}
        ORDER BY r.newsletter_id, r.sent_at, r.id
        LIMIT ${limit}`
      return ok(
        rows.map((row) => ({
          id: row.id,
          newsletterId: row.newsletter_id,
          workspaceId: row.workspace_id,
          subscriberId: row.subscriber_id,
          sentAt: row.sent_at,
          openedAt: row.opened_at,
          clickedAt: row.clicked_at,
          reengagedAt: row.reengaged_at,
          subscriberStatus: row.subscriber_status,
          lastOpenedAt: row.last_opened_at,
          lastClickedAt: row.last_clicked_at,
          action: row.action,
        })),
      )
    } catch (error) {
      return err(
        dbError('Failed to list due CRM newsletter re-engagements', error),
      )
    }
  },

  /** Closes WAITING attempts with their outcome. */
  async resolve(
    ids: string[],
    status: Extract<
      CrmNewsletterReengagementStatus,
      'REENGAGED' | 'UNSUBSCRIBED' | 'FLAGGED' | 'SKIPPED'
    >,
    now: Date,
  ): Promise<Result<number>> {
    if (ids.length === 0) return ok(0)
    try {
      const updated = await prisma.crmNewsletterReengagement.updateMany({
        where: { id: { in: ids }, status: 'WAITING' },
        data: { status, resolvedAt: now },
      })
      return ok(updated.count)
    } catch (error) {
      return err(
        dbError('Failed to resolve CRM newsletter re-engagements', error),
      )
    }
  },

  /** Inactive after the grace period: the ACTIVE ones leave the newsletter. */
  async unsubscribeInactive(
    subscriberIds: string[],
    now: Date,
  ): Promise<Result<number>> {
    if (subscriberIds.length === 0) return ok(0)
    try {
      const updated = await prisma.crmNewsletterSubscriber.updateMany({
        where: { id: { in: subscriberIds }, status: 'ACTIVE' },
        data: {
          status: 'UNSUBSCRIBED',
          unsubscribedAt: now,
          unsubscribeReason: CRM_NEWSLETTER_INACTIVE_REASON,
        },
      })
      return ok(updated.count)
    } catch (error) {
      return err(
        dbError('Failed to unsubscribe inactive CRM newsletter readers', error),
      )
    }
  },

  // ─── Preview and totals ─────────────────────────────────────────────────

  async countWaiting(
    newsletterId: string,
    now: Date,
    graceDays: number,
  ): Promise<Result<{ waiting: number; dueNow: number }>> {
    const graceStart = new Date(now.getTime() - graceDays * DAY_MS)
    try {
      const rows = await prisma.$queryRaw<
        { waiting: bigint; due_now: bigint }[]
      >`
        SELECT
          COUNT(*) FILTER (WHERE r.sent_at > ${graceStart})::bigint AS waiting,
          COUNT(*) FILTER (
            WHERE r.sent_at <= ${graceStart}
              AND r.opened_at IS NULL AND r.clicked_at IS NULL
              AND r.reengaged_at IS NULL
              AND s.status = 'ACTIVE'::"CrmNewsletterSubscriberStatus"
              AND (s.last_opened_at IS NULL OR s.last_opened_at <= r.sent_at)
              AND (s.last_clicked_at IS NULL OR s.last_clicked_at <= r.sent_at)
          )::bigint AS due_now
        FROM crm_newsletter_reengagements r
        JOIN crm_newsletter_subscribers s ON s.id = r.subscriber_id
        WHERE r.newsletter_id = ${newsletterId}
          AND r.status = 'WAITING'::"CrmNewsletterReengagementStatus"`
      return ok({
        waiting: Number(rows[0].waiting),
        dueNow: Number(rows[0].due_now),
      })
    } catch (error) {
      return err(
        dbError('Failed to count waiting CRM newsletter re-engagements', error),
      )
    }
  },

  async totals(
    newsletterId: string,
  ): Promise<Result<CrmNewsletterReengagementTotalsDTO>> {
    try {
      const groups = await prisma.crmNewsletterReengagement.groupBy({
        by: ['status'],
        where: { newsletterId },
        _count: { _all: true },
      })
      const count = (status: CrmNewsletterReengagementStatus) =>
        groups.find((group) => group.status === status)?._count._all ?? 0
      return ok({
        sent:
          count('WAITING') +
          count('REENGAGED') +
          count('UNSUBSCRIBED') +
          count('FLAGGED') +
          count('SKIPPED'),
        reengaged: count('REENGAGED'),
        unsubscribed: count('UNSUBSCRIBED'),
        flagged: count('FLAGGED'),
      })
    } catch (error) {
      return err(
        dbError('Failed to total CRM newsletter re-engagements', error),
      )
    }
  },

  // ─── Webhook and the public button ──────────────────────────────────────

  async findByProviderMessageId(
    providerMessageId: string,
  ): Promise<Result<CrmNewsletterReengagement | null>> {
    try {
      const row = await prisma.crmNewsletterReengagement.findUnique({
        where: { providerMessageId },
      })
      return ok(row)
    } catch (error) {
      return err(
        dbError('Failed to find CRM newsletter re-engagement send', error),
      )
    }
  },

  async markFirst(
    id: string,
    field: 'openedAt' | 'clickedAt',
    at: Date,
  ): Promise<Result<boolean>> {
    try {
      const updated = await prisma.crmNewsletterReengagement.updateMany({
        where: { id, [field]: null },
        data: { [field]: at },
      })
      return ok(updated.count === 1)
    } catch (error) {
      return err(dbError('Failed to mark CRM newsletter re-engagement', error))
    }
  },

  async findWithContext(
    id: string,
  ): Promise<Result<ReengagementWithContext | null>> {
    try {
      const row = await prisma.crmNewsletterReengagement.findUnique({
        where: { id },
        include: {
          newsletter: {
            select: {
              id: true,
              name: true,
              workspace: { select: { name: true } },
            },
          },
          subscriber: {
            select: { id: true, status: true, unsubscribeReason: true },
          },
        },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find CRM newsletter re-engagement', error))
    }
  },

  /**
   * "Quero continuar recebendo": the attempt becomes REENGAGED (also after
   * the grace period), the subscriber's `lastClickedAt` is refreshed and,
   * when the inactivity rule had removed them, they are ACTIVE again.
   * `true` when the subscriber came back.
   */
  async reengage(
    row: Pick<ReengagementWithContext, 'id' | 'subscriberId' | 'subscriber'>,
    now: Date,
  ): Promise<Result<boolean>> {
    const comesBack =
      row.subscriber.status === 'UNSUBSCRIBED' &&
      row.subscriber.unsubscribeReason === CRM_NEWSLETTER_INACTIVE_REASON
    try {
      await prisma.$transaction([
        prisma.crmNewsletterReengagement.update({
          where: { id: row.id },
          data: { status: 'REENGAGED', reengagedAt: now, resolvedAt: now },
        }),
        prisma.crmNewsletterSubscriber.update({
          where: { id: row.subscriberId },
          data: {
            lastClickedAt: now,
            ...(comesBack
              ? {
                  status: 'ACTIVE',
                  unsubscribedAt: null,
                  unsubscribeReason: null,
                }
              : {}),
          },
        }),
      ])
      return ok(comesBack)
    } catch (error) {
      return err(
        dbError('Failed to record CRM newsletter re-engagement', error),
      )
    }
  },
}
