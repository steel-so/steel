import { describe, expect, it } from 'vitest'
import {
  computeLeadScore,
  findLeadRoutingOwner,
  isLeadEventRuleField,
  matchesLeadEventRule,
  matchesLeadRule,
} from '../crm-lead-rules'

const subject = {
  name: 'Jane Doe',
  emails: ['jane@acme.com'],
  phones: [],
  company: 'Acme',
  jobTitle: null,
  source: 'ads',
  city: null,
}

describe('matchesLeadRule()', () => {
  it('should match equals', () => {
    expect(
      matchesLeadRule(subject, {
        field: 'source',
        operator: 'equals',
        value: 'ads',
      }),
    ).toBe(true)
  })

  it('should match contains', () => {
    expect(
      matchesLeadRule(subject, {
        field: 'email',
        operator: 'contains',
        value: 'acme',
      }),
    ).toBe(true)
  })

  it('should match is_empty for an absent field', () => {
    expect(
      matchesLeadRule(subject, {
        field: 'jobTitle',
        operator: 'is_empty',
        value: null,
      }),
    ).toBe(true)
  })

  it('should match is_not_empty for a present field', () => {
    expect(
      matchesLeadRule(subject, {
        field: 'company',
        operator: 'is_not_empty',
        value: null,
      }),
    ).toBe(true)
  })

  it('should not match not_equals when values are equal', () => {
    expect(
      matchesLeadRule(subject, {
        field: 'source',
        operator: 'not_equals',
        value: 'ads',
      }),
    ).toBe(false)
  })
})

describe('computeLeadScore()', () => {
  it('should sum points from all matching active rules', () => {
    const score = computeLeadScore(subject, [
      {
        field: 'source',
        operator: 'equals',
        value: 'ads',
        points: 10,
        active: true,
      },
      {
        field: 'email',
        operator: 'contains',
        value: 'acme',
        points: 5,
        active: true,
      },
      {
        field: 'city',
        operator: 'is_not_empty',
        value: null,
        points: 20,
        active: true,
      },
    ])
    expect(score).toBe(15)
  })

  it('should ignore inactive rules', () => {
    const score = computeLeadScore(subject, [
      {
        field: 'source',
        operator: 'equals',
        value: 'ads',
        points: 10,
        active: false,
      },
    ])
    expect(score).toBe(0)
  })
})

describe('findLeadRoutingOwner()', () => {
  it('should return the owner of the first matching active rule', () => {
    const owner = findLeadRoutingOwner(subject, [
      {
        field: 'city',
        operator: 'equals',
        value: 'SP',
        ownerId: 'u1',
        active: true,
      },
      {
        field: 'source',
        operator: 'equals',
        value: 'ads',
        ownerId: 'u2',
        active: true,
      },
    ])
    expect(owner).toBe('u2')
  })

  it('should return null when no rule matches', () => {
    const owner = findLeadRoutingOwner(subject, [
      {
        field: 'city',
        operator: 'equals',
        value: 'SP',
        ownerId: 'u1',
        active: true,
      },
    ])
    expect(owner).toBeNull()
  })
})

describe('newsletter event rules (ADR 0054 phase 2)', () => {
  const eventRule = (
    field: 'newsletter_subscribed' | 'newsletter_opened' | 'newsletter_clicked',
    value: string | null = null,
    active = true,
  ) => ({ field, operator: 'contains' as const, value, active, points: 10 })

  it('reads every lead field', () => {
    const full = {
      ...subject,
      phones: ['119'],
      jobTitle: 'CTO',
      city: 'SP',
    }
    const read = (field: 'name' | 'phone' | 'jobTitle' | 'city') =>
      matchesLeadRule(full, { field, operator: 'is_not_empty', value: null })
    expect(
      ['name', 'phone', 'jobTitle', 'city'].map((f) => read(f as never)),
    ).toEqual([true, true, true, true])
  })

  it('treats a missing value as empty', () => {
    const empty = { ...subject, city: null }
    expect(
      matchesLeadRule(empty, {
        field: 'city',
        operator: 'equals',
        value: null,
      }),
    ).toBe(true)
    expect(
      matchesLeadRule(empty, {
        field: 'city',
        operator: 'not_equals',
        value: null,
      }),
    ).toBe(false)
    expect(
      matchesLeadRule(empty, {
        field: 'city',
        operator: 'contains',
        value: null,
      }),
    ).toBe(false)
  })

  it('tells event fields apart from lead fields', () => {
    expect(isLeadEventRuleField('newsletter_opened')).toBe(true)
    expect(isLeadEventRuleField('city')).toBe(false)
  })

  it('never matches an event rule against lead fields', () => {
    for (const field of [
      'newsletter_subscribed',
      'newsletter_opened',
      'newsletter_clicked',
    ] as const) {
      expect(
        matchesLeadRule(subject, { field, operator: 'is_empty', value: null }),
      ).toBe(true)
    }
    for (const field of ['phone', 'jobTitle', 'city'] as const) {
      expect(
        matchesLeadRule(
          { ...subject, emails: [], company: null, source: null },
          { field, operator: 'is_empty', value: null },
        ),
      ).toBe(true)
    }
    expect(
      matchesLeadRule(
        { ...subject, emails: [] },
        { field: 'email', operator: 'is_empty', value: null },
      ),
    ).toBe(true)
    expect(
      matchesLeadRule(
        { ...subject, company: null, source: null },
        { field: 'company', operator: 'is_empty', value: null },
      ),
    ).toBe(true)
    expect(
      matchesLeadRule(
        { ...subject, source: null },
        { field: 'source', operator: 'is_empty', value: null },
      ),
    ).toBe(true)
    expect(
      computeLeadScore(subject, [eventRule('newsletter_opened', null)]),
    ).toBe(0)
    expect(
      findLeadRoutingOwner(subject, [
        { ...eventRule('newsletter_opened'), ownerId: 'u1' },
      ]),
    ).toBeNull()
  })

  it('matches the event type, and clicks by "URL contains"', () => {
    expect(
      matchesLeadEventRule(eventRule('newsletter_opened'), {
        field: 'newsletter_opened',
      }),
    ).toBe(true)
    expect(
      matchesLeadEventRule(eventRule('newsletter_opened', null, false), {
        field: 'newsletter_opened',
      }),
    ).toBe(false)
    expect(
      matchesLeadEventRule(eventRule('newsletter_opened'), {
        field: 'newsletter_clicked',
      }),
    ).toBe(false)
    const click = {
      field: 'newsletter_clicked' as const,
      url: 'https://a.com/Precos',
    }
    expect(matchesLeadEventRule(eventRule('newsletter_clicked'), click)).toBe(
      true,
    )
    expect(
      matchesLeadEventRule(eventRule('newsletter_clicked', ' '), click),
    ).toBe(true)
    expect(
      matchesLeadEventRule(eventRule('newsletter_clicked', '/precos'), click),
    ).toBe(true)
    expect(
      matchesLeadEventRule(eventRule('newsletter_clicked', '/blog'), click),
    ).toBe(false)
    expect(
      matchesLeadEventRule(eventRule('newsletter_clicked', '/blog'), {
        field: 'newsletter_clicked',
      }),
    ).toBe(false)
  })
})
