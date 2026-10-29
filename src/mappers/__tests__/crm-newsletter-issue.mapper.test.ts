import { describe, expect, it } from 'vitest'
import {
  createFakeNewsletterIssue,
  createFakeNewsletterRecipient,
} from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import type { CrmNewsletterIssueStatsDTO } from '@/src/schemas/crm-newsletter-issue.schema'
import {
  rate,
  toCrmNewsletterIssueDTO,
  toCrmNewsletterIssueRecipientDTO,
  toCrmNewsletterIssueTrendDTO,
  toCrmNewsletterUsageDTO,
} from '../crm-newsletter-issue.mapper'

const AT = new Date('2026-10-28T13:00:00.000Z')

function stats(
  overrides?: Partial<CrmNewsletterIssueStatsDTO>,
): CrmNewsletterIssueStatsDTO {
  return {
    recipients: 10,
    sent: 10,
    skipped: 0,
    failed: 0,
    delivered: 9,
    opened: 4,
    clicked: 1,
    bounced: 1,
    complained: 0,
    unsubscribed: 0,
    ...overrides,
  }
}

describe('crm-newsletter-issue.mapper', () => {
  it('maps an issue without the document by default', () => {
    const issue = createFakeNewsletterIssue({
      status: 'SENT',
      number: 3,
      sentAt: AT,
      scheduledAt: AT,
    })
    const dto = toCrmNewsletterIssueDTO(issue)
    expect(dto).toMatchObject({
      id: issue.id,
      number: 3,
      status: 'SENT',
      sentAt: AT.toISOString(),
      scheduledAt: AT.toISOString(),
      sendingStartedAt: null,
      stats: null,
      webUrl: null,
    })
    expect(dto).not.toHaveProperty('builderDocument')
  })

  it('adds stats, web URL and the document when asked', () => {
    const issue = createFakeNewsletterIssue()
    const dto = toCrmNewsletterIssueDTO(issue, {
      stats: stats(),
      webUrl: 'https://x/n/a/b/c',
      includeDocument: true,
    })
    expect(dto.builderDocument).toEqual(issue.builderDocument)
    expect(dto.stats?.opened).toBe(4)
    expect(dto.webUrl).toBe('https://x/n/a/b/c')
  })

  it('maps a recipient', () => {
    const dto = toCrmNewsletterIssueRecipientDTO(
      createFakeNewsletterRecipient({
        status: 'SENT',
        sentAt: AT,
        openedAt: AT,
      }),
    )
    expect(dto).toMatchObject({
      status: 'SENT',
      sentAt: AT.toISOString(),
      openedAt: AT.toISOString(),
      clickedAt: null,
    })
  })

  it('computes rates over the sent e-mails', () => {
    expect(rate(1, 3)).toBe(0.3333)
    expect(rate(1, 0)).toBeNull()
  })

  it('builds the trend oldest first', () => {
    const newer = createFakeNewsletterIssue({ id: 'b', number: 2, sentAt: AT })
    const older = createFakeNewsletterIssue({ id: 'a', number: 1 })
    const trend = toCrmNewsletterIssueTrendDTO(
      [newer, older],
      new Map([['b', stats({ sent: 4, opened: 2, clicked: 1 })]]),
    )
    expect(trend.issues.map((issue) => issue.id)).toEqual(['a', 'b'])
    expect(trend.issues[0]).toMatchObject({
      recipients: 0,
      openRate: null,
      clickRate: null,
      sentAt: null,
    })
    expect(trend.issues[1]).toMatchObject({ openRate: 0.5, clickRate: 0.25 })
  })

  it('resolves the usage limit from the override or the plan', () => {
    const base = { month: '2026-10', usage: null, planLimit: 3000 }
    expect(toCrmNewsletterUsageDTO({ ...base, settings: null })).toEqual({
      month: '2026-10',
      emailsSent: 0,
      limit: 3000,
      limitSource: 'PLAN',
    })
    expect(
      toCrmNewsletterUsageDTO({
        ...base,
        usage: {
          workspaceId: 'w',
          month: '2026-10',
          emailsSent: 12,
          notifiedThresholds: [],
          updatedAt: AT,
        },
        settings: {
          workspaceId: 'w',
          monthlyEmailLimitOverride: 50,
          updatedById: null,
          updatedAt: AT,
        },
      }),
    ).toEqual({
      month: '2026-10',
      emailsSent: 12,
      limit: 50,
      limitSource: 'OVERRIDE',
    })
  })
})
