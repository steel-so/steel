import { describe, expect, it } from 'vitest'
import {
  compileSegmentRules,
  conditionKey,
  OPT_OUT_KEY,
  type SegmentContext,
  segmentNeeds,
  segmentWhere,
} from '@/src/lib/crm-segment/compile'
import type {
  CrmSegmentCondition,
  CrmSegmentDefinition,
} from '@/src/schemas/crm-segment.schema'

const NOW = new Date('2026-11-19T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

const EMPTY_CTX: SegmentContext = { sets: {}, now: NOW }

function def(
  conditions: CrmSegmentCondition[],
  overrides: Partial<CrmSegmentDefinition> = {},
): CrmSegmentDefinition {
  return { match: 'ALL', conditions, groups: [], ...overrides }
}

describe('compileSegmentRules', () => {
  it('compiles an empty segment to every record', () => {
    expect(compileSegmentRules('PERSON', def([]), EMPTY_CTX)).toEqual({})
  })

  it('joins top-level rules with AND or OR', () => {
    const conditions: CrmSegmentCondition[] = [
      { type: 'text', field: 'city', op: 'equals', value: 'Recife' },
      { type: 'createdAt', op: 'withinDays', days: 10 },
    ]
    const all = compileSegmentRules('PERSON', def(conditions), EMPTY_CTX)
    expect(all).toEqual({
      AND: [
        { city: { equals: 'Recife', mode: 'insensitive' } },
        { createdAt: { gte: new Date(NOW.getTime() - 10 * DAY) } },
      ],
    })

    const any = compileSegmentRules(
      'PERSON',
      def(conditions, { match: 'ANY' }),
      EMPTY_CTX,
    )
    expect(Object.keys(any)).toEqual(['OR'])
  })

  it('nests groups with their own match', () => {
    const where = compileSegmentRules(
      'LEAD',
      def([{ type: 'leadStage', stages: ['QUALIFIED'] }], {
        groups: [
          {
            match: 'ANY',
            conditions: [
              { type: 'text', field: 'source', op: 'equals', value: 'site' },
              { type: 'number', field: 'score', op: 'gte', value: 50 },
            ],
          },
        ],
      }),
      EMPTY_CTX,
    )
    expect(where).toEqual({
      AND: [
        { stage: { in: ['QUALIFIED'] } },
        {
          OR: [
            { source: { equals: 'site', mode: 'insensitive' } },
            { score: { gte: 50 } },
          ],
        },
      ],
    })
  })

  it('matches e-mail and phone as list items and never uses contains on them', () => {
    expect(
      compileSegmentRules(
        'PERSON',
        def([{ type: 'text', field: 'email', op: 'equals', value: 'A@B.com' }]),
        EMPTY_CTX,
      ),
    ).toEqual({ AND: [{ emails: { has: 'a@b.com' } }] })
    expect(
      compileSegmentRules(
        'PERSON',
        def([{ type: 'text', field: 'phone', op: 'isNotSet' }]),
        EMPTY_CTX,
      ),
    ).toEqual({ AND: [{ phones: { isEmpty: true } }] })
  })

  it('never filters a required column on null', () => {
    const where = compileSegmentRules(
      'COMPANY',
      def([{ type: 'text', field: 'name', op: 'isNotSet' }]),
      EMPTY_CTX,
    )
    expect(where).toEqual({ AND: [{ name: '' }] })
  })

  it('uses the resolved set of a custom field and negates "isNotSet"', () => {
    const set = {
      personIds: ['p1', 'p2'],
      leadIds: [],
      companyIds: [],
      emails: [],
    }
    const isSet: CrmSegmentCondition = {
      type: 'customField',
      definitionId: 'd1',
      op: 'isSet',
    }
    const notSet: CrmSegmentCondition = { ...isSet, op: 'isNotSet' }
    // "isNotSet" shares the key of "isSet": one lookup serves both.
    expect(conditionKey(isSet)).toBe(conditionKey(notSet))
    const ctx: SegmentContext = {
      now: NOW,
      sets: { [conditionKey(isSet) as string]: set },
    }
    expect(compileSegmentRules('PERSON', def([isSet]), ctx)).toEqual({
      AND: [{ id: { in: ['p1', 'p2'] } }],
    })
    expect(compileSegmentRules('PERSON', def([notSet]), ctx)).toEqual({
      AND: [{ NOT: { id: { in: ['p1', 'p2'] } } }],
    })
  })

  it('keeps people without a company when negating a deal rule', () => {
    const where = compileSegmentRules(
      'PERSON',
      def([{ type: 'deals', kind: 'won', has: false }]),
      EMPTY_CTX,
    ) as { AND: { AND: unknown[] }[] }
    const [inner] = where.AND
    expect(inner.AND).toHaveLength(2)
    expect(JSON.stringify(inner.AND[1])).toContain('"companyId":null')
  })

  it('limits won deals to the last N days', () => {
    const where = compileSegmentRules(
      'COMPANY',
      def([{ type: 'deals', kind: 'won', has: true, withinDays: 90 }]),
      EMPTY_CTX,
    )
    expect(where).toEqual({
      AND: [
        {
          opportunities: {
            some: {
              deletedAt: null,
              stage: { is: { category: 'WON' } },
              wonAt: { gte: new Date(NOW.getTime() - 90 * DAY) },
            },
          },
        },
      ],
    })
  })

  it('treats a lead as the contact of its converted person for engagement', () => {
    const cond: CrmSegmentCondition = {
      type: 'emailEngagement',
      event: 'opened',
      op: 'any',
      days: 30,
    }
    const ctx: SegmentContext = {
      now: NOW,
      sets: {
        [conditionKey(cond) as string]: {
          personIds: ['p1'],
          leadIds: ['l1'],
          companyIds: [],
          emails: [],
        },
      },
    }
    expect(compileSegmentRules('LEAD', def([cond]), ctx)).toEqual({
      AND: [
        {
          OR: [{ id: { in: ['l1'] } }, { convertedPersonId: { in: ['p1'] } }],
        },
      ],
    })
  })

  it('applies the opt-out set to e-mail consent rules', () => {
    const optedOut: CrmSegmentCondition = {
      type: 'consent',
      value: 'emailOptedOut',
    }
    expect(conditionKey(optedOut)).toBe(OPT_OUT_KEY)
    const ctx: SegmentContext = {
      now: NOW,
      sets: {
        [OPT_OUT_KEY]: {
          personIds: ['p9'],
          leadIds: [],
          companyIds: [],
          emails: ['x@y.com'],
        },
      },
    }
    const allowed = compileSegmentRules(
      'PERSON',
      def([{ type: 'consent', value: 'emailAllowed' }]),
      ctx,
    )
    expect(allowed).toEqual({
      AND: [
        {
          NOT: {
            OR: [{ emails: { hasSome: ['x@y.com'] } }, { id: { in: ['p9'] } }],
          },
        },
      ],
    })
  })
})

describe('segmentNeeds', () => {
  it('lists each distinct lookup once, including rules inside groups', () => {
    const activity: CrmSegmentCondition = {
      type: 'activity',
      op: 'withinDays',
      days: 7,
    }
    const needs = segmentNeeds(
      def([activity, { type: 'activity', op: 'noneInDays', days: 7 }], {
        groups: [
          {
            match: 'ANY',
            conditions: [
              { type: 'mailingList', op: 'in', listIds: ['b', 'a'] },
              { type: 'text', field: 'name', op: 'contains', value: 'x' },
            ],
          },
        ],
      }),
    )
    expect(needs.map((n) => n.key)).toEqual(['act|7', 'list|a,b'])
  })
})

describe('segmentWhere', () => {
  it('scopes to the workspace and skips deleted records', () => {
    expect(segmentWhere('ws1', 'COMPANY', def([]), EMPTY_CTX)).toEqual({
      AND: [{ workspaceId: 'ws1', deletedAt: null }, {}],
    })
  })
})
