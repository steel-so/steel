import { describe, expect, it } from 'vitest'
import { createFakeNewsletterIssue } from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import { createFakeNewsletterDigest } from '@/src/__tests__/factories/newsletter2-digest-ai.factory'
import {
  toCrmNewsletterAbTestDTO,
  toCrmNewsletterAbVariantStatsDTO,
} from '../crm-newsletter-ab.mapper'
import { toCrmNewsletterDigestDTO } from '../crm-newsletter-digest.mapper'
import { toCrmNewsletterIssueDTO } from '../crm-newsletter-issue.mapper'

const NOW = new Date('2026-10-28T13:00:00.000Z')

describe('toCrmNewsletterDigestDTO', () => {
  it('maps the settings with the site name', () => {
    const dto = toCrmNewsletterDigestDTO(
      createFakeNewsletterDigest({
        nextRunAt: NOW,
        lastOutcome: 'SENT',
        site: {
          id: 'site1',
          name: 'Site Acme',
          slug: 'acme',
          publishedAt: NOW,
          deletedAt: null,
        },
      }),
    )
    expect(dto).toMatchObject({
      siteId: 'site1',
      siteName: 'Site Acme',
      nextRunAt: NOW.toISOString(),
      lastRunAt: null,
      lastOutcome: 'SENT',
      updatedAt: NOW.toISOString(),
    })
  })

  it('hides a deleted site and an unknown outcome', () => {
    const dto = toCrmNewsletterDigestDTO(
      createFakeNewsletterDigest({
        lastOutcome: 'WHATEVER',
        site: {
          id: 'site1',
          name: 'Velho',
          slug: 'v',
          publishedAt: null,
          deletedAt: NOW,
        },
      }),
    )
    expect(dto.siteName).toBeNull()
    expect(dto.lastOutcome).toBeNull()
    expect(
      toCrmNewsletterDigestDTO(createFakeNewsletterDigest({ site: null }))
        .siteName,
    ).toBeNull()
  })
})

describe('A/B mappers', () => {
  it('is null without a variant B and fills the decision time once sending', () => {
    expect(toCrmNewsletterAbTestDTO(createFakeNewsletterIssue())).toBeNull()
    const dto = toCrmNewsletterAbTestDTO(
      createFakeNewsletterIssue({
        abSubjectB: 'B',
        abTestPercent: 30,
        abMetric: 'CLICKS',
        abWaitHours: 2,
        abWinner: 'B',
        abDecidedAt: NOW,
        sendingStartedAt: NOW,
      }),
    )
    expect(dto).toEqual({
      subjectB: 'B',
      testPercent: 30,
      metric: 'CLICKS',
      waitHours: 2,
      winner: 'B',
      decidedAt: NOW.toISOString(),
      decideAt: '2026-10-28T15:00:00.000Z',
    })
    expect(
      toCrmNewsletterAbTestDTO(
        createFakeNewsletterIssue({ abSubjectB: 'B', abWinner: 'X' }),
      ),
    ).toMatchObject({
      testPercent: 20,
      metric: 'OPENS',
      waitHours: 4,
      winner: null,
      decideAt: null,
    })
  })

  it('lists both variants with rates, zeros for a missing one', () => {
    const rows = toCrmNewsletterAbVariantStatsDTO(
      [{ variant: 'A', recipients: 10, sent: 8, opened: 4, clicked: 1 }],
      { A: 'Assunto A', B: 'Assunto B' },
    )
    expect(rows).toEqual([
      {
        variant: 'A',
        subject: 'Assunto A',
        recipients: 10,
        sent: 8,
        opened: 4,
        clicked: 1,
        openRate: 0.5,
        clickRate: 0.125,
      },
      {
        variant: 'B',
        subject: 'Assunto B',
        recipients: 0,
        sent: 0,
        opened: 0,
        clicked: 0,
        openRate: null,
        clickRate: null,
      },
    ])
  })

  it('adds the A/B test and the digest to the issue DTO', () => {
    const dto = toCrmNewsletterIssueDTO(
      createFakeNewsletterIssue({ abSubjectB: 'B', digestId: 'dg1' }),
    )
    expect(dto.abTest?.subjectB).toBe('B')
    expect(dto.digestId).toBe('dg1')
  })
})
