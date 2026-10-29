import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  type CustomFieldCondition,
  compileCondition,
  compileNewsletterSegment,
  customFieldKey,
  customFieldValueWhere,
  parseStoredSegment,
  type SegmentContext,
  saoPauloDayStart,
  segmentNeeds,
} from '@/src/lib/crm-newsletter/segment-where'

const CTX: SegmentContext = {
  recentIssueIds: ['i3', 'i2', 'i1'],
  customFieldPersonIds: {
    'd1|equals|"pro"': ['p1'],
    'd1|isSet|': ['p1', 'p2'],
  },
}

describe('segment-where', () => {
  it('reads São Paulo days at -03:00', () => {
    expect(saoPauloDayStart('2026-10-01').toISOString()).toBe(
      '2026-10-01T03:00:00.000Z',
    )
  })

  it('compiles an empty segment to no filter', () => {
    expect(
      compileNewsletterSegment({ conditions: [], groups: [] }, CTX),
    ).toEqual({})
  })

  it('joins conditions with AND and groups with OR', () => {
    expect(
      compileNewsletterSegment(
        {
          conditions: [{ type: 'neverOpened' }],
          groups: [
            {
              conditions: [
                { type: 'confirmed', value: true },
                { type: 'source', sources: ['FORM'] },
              ],
            },
          ],
        },
        CTX,
      ),
    ).toEqual({
      AND: [
        { lastOpenedAt: null },
        {
          OR: [{ confirmedAt: { not: null } }, { source: { in: ['FORM'] } }],
        },
      ],
    })
  })

  it('compiles subscriber and engagement conditions', () => {
    expect(
      compileCondition(
        { type: 'subscribed', op: 'before', date: '2026-10-01' },
        CTX,
      ),
    ).toEqual({ createdAt: { lt: new Date('2026-10-01T03:00:00.000Z') } })
    expect(
      compileCondition(
        { type: 'subscribed', op: 'onOrAfter', date: '2026-10-01' },
        CTX,
      ),
    ).toEqual({ createdAt: { gte: new Date('2026-10-01T03:00:00.000Z') } })
    expect(compileCondition({ type: 'confirmed', value: false }, CTX)).toEqual({
      confirmedAt: null,
    })
    expect(
      compileCondition({ type: 'opened', op: 'any', lastIssues: 2 }, CTX),
    ).toEqual({
      deliveries: {
        some: { issueId: { in: ['i3', 'i2'] }, openedAt: { not: null } },
      },
    })
    expect(
      compileCondition({ type: 'clicked', op: 'none', lastIssues: 9 }, CTX),
    ).toEqual({
      deliveries: {
        none: {
          issueId: { in: ['i3', 'i2', 'i1'] },
          clickedAt: { not: null },
        },
      },
    })
    const noIssues = { ...CTX, recentIssueIds: [] }
    expect(
      compileCondition({ type: 'opened', op: 'any', lastIssues: 2 }, noIssues),
    ).toEqual({ id: { in: [] } })
    expect(
      compileCondition({ type: 'opened', op: 'none', lastIssues: 2 }, noIssues),
    ).toEqual({})
    expect(
      compileCondition({ type: 'lastOpenedBefore', date: '2026-09-01' }, CTX),
    ).toEqual({ lastOpenedAt: { lt: new Date('2026-09-01T03:00:00.000Z') } })
  })

  it('compiles person conditions, keeping subscribers without a person on negations', () => {
    const alive = { deletedAt: null }
    expect(
      compileCondition({ type: 'linkedPerson', value: true }, CTX),
    ).toEqual({ person: { is: alive } })
    expect(
      compileCondition({ type: 'linkedPerson', value: false }, CTX),
    ).toEqual({
      OR: [{ personId: null }, { NOT: { person: { is: alive } } }],
    })
    expect(
      compileCondition({ type: 'company', companyIds: ['c1'] }, CTX),
    ).toEqual({ person: { is: { ...alive, companyId: { in: ['c1'] } } } })
    expect(
      compileCondition({ type: 'jobTitle', op: 'equals', value: 'CEO' }, CTX),
    ).toEqual({
      person: {
        is: { ...alive, jobTitle: { equals: 'CEO', mode: 'insensitive' } },
      },
    })
    expect(
      compileCondition({ type: 'city', op: 'contains', value: 'camp' }, CTX),
    ).toEqual({
      person: {
        is: { ...alive, city: { contains: 'camp', mode: 'insensitive' } },
      },
    })
    expect(
      compileCondition(
        { type: 'customField', definitionId: 'd1', op: 'equals', value: 'Pro' },
        CTX,
      ),
    ).toEqual({ person: { is: { ...alive, id: { in: ['p1'] } } } })
    expect(
      compileCondition(
        { type: 'customField', definitionId: 'd1', op: 'isNotSet' },
        CTX,
      ),
    ).toEqual({
      OR: [
        { personId: null },
        { NOT: { person: { is: { ...alive, id: { in: ['p1', 'p2'] } } } } },
      ],
    })
    expect(
      compileCondition(
        { type: 'customField', definitionId: 'zz', op: 'isSet' },
        CTX,
      ),
    ).toEqual({ person: { is: { ...alive, id: { in: [] } } } })
    const open = compileCondition({ type: 'openOpportunity', value: true }, CTX)
    expect(JSON.stringify(open)).toContain('opportunitiesAsPointOfContact')
    expect(
      compileCondition({ type: 'openOpportunity', value: false }, CTX),
    ).toHaveProperty('OR.0', { personId: null })
    expect(
      compileCondition({ type: 'leadStage', stages: ['PROPOSAL'] }, CTX),
    ).toEqual({
      person: {
        is: {
          ...alive,
          convertedFromLeads: {
            some: { deletedAt: null, stage: { in: ['PROPOSAL'] } },
          },
        },
      },
    })
  })

  it('lists what must be resolved first', () => {
    const needs = segmentNeeds({
      conditions: [
        { type: 'opened', op: 'any', lastIssues: 3 },
        { type: 'customField', definitionId: 'd1', op: 'isNotSet' },
      ],
      groups: [
        {
          conditions: [
            { type: 'clicked', op: 'any', lastIssues: 7 },
            { type: 'customField', definitionId: 'd1', op: 'isSet' },
            {
              type: 'customField',
              definitionId: 'd1',
              op: 'equals',
              value: 'Pro',
            },
          ],
        },
      ],
    })
    expect(needs.lookback).toBe(7)
    expect(needs.customFields).toEqual([
      { type: 'customField', definitionId: 'd1', op: 'isSet' },
      { type: 'customField', definitionId: 'd1', op: 'equals', value: 'Pro' },
    ])
    expect(segmentNeeds({ conditions: [], groups: [] })).toEqual({
      lookback: 0,
      customFields: [],
    })
  })

  it('builds custom field keys and value filters', () => {
    const base: CustomFieldCondition = {
      type: 'customField',
      definitionId: 'd1',
      op: 'equals',
      value: 'Pro',
    }
    expect(customFieldKey(base)).toBe('d1|equals|"pro"')
    expect(customFieldKey({ ...base, op: 'isNotSet' })).toBe('d1|isSet|')
    expect(customFieldKey({ ...base, value: undefined })).toBe('d1|equals|null')
    expect(customFieldValueWhere(base)).toEqual({ value: { equals: 'Pro' } })
    expect(customFieldValueWhere({ ...base, value: undefined })).toEqual({
      value: { equals: '' },
    })
    expect(customFieldValueWhere({ ...base, op: 'contains' })).toEqual({
      value: { string_contains: 'Pro' },
    })
    expect(
      customFieldValueWhere({ ...base, op: 'contains', value: undefined }),
    ).toEqual({ value: { string_contains: '' } })
    expect(customFieldValueWhere({ ...base, op: 'isSet' })).toEqual({
      NOT: [{ value: { equals: Prisma.JsonNull } }, { value: { equals: '' } }],
    })
  })

  it('parses stored segments, refusing unreadable ones', () => {
    expect(parseStoredSegment({})).toEqual({ conditions: [], groups: [] })
    expect(parseStoredSegment(null)).toEqual({ conditions: [], groups: [] })
    expect(parseStoredSegment({ conditions: [{ type: 'gone' }] })).toBeNull()
  })
})
