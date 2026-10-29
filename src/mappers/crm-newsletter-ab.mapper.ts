import type { CrmNewsletterIssue } from '@prisma/client'
import {
  type AbVariantCounts,
  abDecideAt,
} from '@/src/lib/crm-newsletter/ab-test'
import type {
  CrmNewsletterAbTestDTO,
  CrmNewsletterAbVariantStatsDTO,
} from '@/src/schemas/crm-newsletter-ab.schema'

/** Subject A/B test of an issue (nl2-digest-ai); null without a variant B. */
export function toCrmNewsletterAbTestDTO(
  issue: Pick<
    CrmNewsletterIssue,
    | 'abSubjectB'
    | 'abTestPercent'
    | 'abMetric'
    | 'abWaitHours'
    | 'abWinner'
    | 'abDecidedAt'
    | 'sendingStartedAt'
  >,
): CrmNewsletterAbTestDTO | null {
  if (!issue.abSubjectB) return null
  const waitHours = issue.abWaitHours ?? 4
  return {
    subjectB: issue.abSubjectB,
    testPercent: issue.abTestPercent ?? 20,
    metric: issue.abMetric ?? 'OPENS',
    waitHours,
    winner:
      issue.abWinner === 'A' || issue.abWinner === 'B' ? issue.abWinner : null,
    decidedAt: issue.abDecidedAt ? issue.abDecidedAt.toISOString() : null,
    decideAt: issue.sendingStartedAt
      ? abDecideAt(issue.sendingStartedAt, waitHours).toISOString()
      : null,
  }
}

const rate = (part: number, sent: number) =>
  sent > 0 ? Math.round((part / sent) * 10_000) / 10_000 : null

/** Variant rows of the report, A then B (missing variants with zeros). */
export function toCrmNewsletterAbVariantStatsDTO(
  counts: AbVariantCounts[],
  subjects: { A: string; B: string },
): CrmNewsletterAbVariantStatsDTO[] {
  return (['A', 'B'] as const).map((variant) => {
    const row = counts.find((entry) => entry.variant === variant) ?? {
      variant,
      recipients: 0,
      sent: 0,
      opened: 0,
      clicked: 0,
    }
    return {
      variant,
      subject: subjects[variant],
      recipients: row.recipients,
      sent: row.sent,
      opened: row.opened,
      clicked: row.clicked,
      openRate: rate(row.opened, row.sent),
      clickRate: rate(row.clicked, row.sent),
    }
  })
}
