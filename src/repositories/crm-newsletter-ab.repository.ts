import type { CrmNewsletterIssue } from '@prisma/client'
import type { AbVariantCounts } from '@/src/lib/crm-newsletter/ab-test'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { EDITABLE_ISSUE_STATUSES } from './crm-newsletter-issue.repository'
import { dbError } from './db-error'

/**
 * Subject A/B test of a newsletter issue (newsletter2 nl2-digest-ai): the
 * settings on the issue, the variant counters of the test share, the due
 * decisions of the worker and the release of the held rest of the
 * audience. The split itself happens in the audience snapshot
 * (`CrmNewsletterIssueRepository.startSending`).
 */

export type AbSettings = {
  abSubjectB: string | null
  abTestPercent: number | null
  abMetric: 'OPENS' | 'CLICKS' | null
  abWaitHours: number | null
}

export const CrmNewsletterAbRepository = {
  /** Writes the test settings while the issue is editable (`null` = lost). */
  async setSettings(
    issueId: string,
    data: AbSettings & { updatedById: string },
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
      return ok(
        await prisma.crmNewsletterIssue.findUnique({ where: { id: issueId } }),
      )
    } catch (error) {
      return err(dbError('Failed to save CRM newsletter A/B test', error))
    }
  },

  /** Counters of the test share by variant (A first). */
  async variantCounts(issueId: string): Promise<Result<AbVariantCounts[]>> {
    try {
      const rows = await prisma.$queryRaw<
        {
          variant: string
          recipients: bigint
          sent: bigint
          opened: bigint
          clicked: bigint
        }[]
      >`
        SELECT ab_variant AS variant,
          COUNT(*)::bigint AS recipients,
          COUNT(*) FILTER (WHERE status = 'SENT')::bigint AS sent,
          COUNT(opened_at)::bigint AS opened,
          COUNT(clicked_at)::bigint AS clicked
        FROM crm_newsletter_issue_recipients
        WHERE issue_id = ${issueId} AND ab_variant IS NOT NULL
        GROUP BY ab_variant
        ORDER BY ab_variant`
      return ok(
        rows.map((row) => ({
          variant: row.variant === 'B' ? 'B' : 'A',
          recipients: Number(row.recipients),
          sent: Number(row.sent),
          opened: Number(row.opened),
          clicked: Number(row.clicked),
        })),
      )
    } catch (error) {
      return err(dbError('Failed to count CRM newsletter A/B variants', error))
    }
  },

  async countHeld(issueId: string): Promise<Result<number>> {
    try {
      const count = await prisma.crmNewsletterIssueRecipient.count({
        where: { issueId, abHeld: true, status: 'PENDING' },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to count held CRM newsletter rows', error))
    }
  },

  /** SENDING issues with an undecided test whose wait is over. */
  async listDueDecisions(
    now: Date,
    limit = 50,
  ): Promise<Result<CrmNewsletterIssue[]>> {
    try {
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM crm_newsletter_issues
        WHERE status = 'SENDING'::"CrmNewsletterIssueStatus"
          AND deleted_at IS NULL
          AND ab_subject_b IS NOT NULL
          AND ab_winner IS NULL
          AND sending_started_at IS NOT NULL
          AND sending_started_at + make_interval(hours => COALESCE(ab_wait_hours, 0)) <= ${now}
        ORDER BY sending_started_at
        LIMIT ${limit}`
      if (rows.length === 0) return ok([])
      const issues = await prisma.crmNewsletterIssue.findMany({
        where: { id: { in: rows.map((row) => row.id) } },
        orderBy: { sendingStartedAt: 'asc' },
      })
      return ok(issues)
    } catch (error) {
      return err(dbError('Failed to list due CRM newsletter A/B tests', error))
    }
  },

  /**
   * Records the winner (once: only while undecided and SENDING) and
   * releases the held rows in the same transaction. `null` = lost.
   */
  async decide(
    issueId: string,
    winner: 'A' | 'B',
    now: Date,
  ): Promise<Result<{ released: number } | null>> {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.crmNewsletterIssue.updateMany({
          where: { id: issueId, status: 'SENDING', abWinner: null },
          data: { abWinner: winner, abDecidedAt: now },
        })
        if (updated.count === 0) return null
        const released = await tx.crmNewsletterIssueRecipient.updateMany({
          where: { issueId, abHeld: true },
          data: { abHeld: false },
        })
        return { released: released.count }
      })
      return ok(result)
    } catch (error) {
      return err(dbError('Failed to decide CRM newsletter A/B test', error))
    }
  },
}
