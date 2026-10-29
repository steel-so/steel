import { describe, expect, it } from 'vitest'
import {
  AudiencePreviewSchema,
  CreateCrmNewsletterSegmentSchema,
  isEmptySegment,
  NewsletterSegmentSchema,
  SegmentOptionsQuerySchema,
  SetIssueSegmentSchema,
  StoredIssueSegmentSchema,
  UpdateCrmNewsletterSegmentSchema,
} from '../crm-newsletter-segment.schema'

describe('NewsletterSegmentSchema', () => {
  it('defaults `{}` to an empty segment (everyone)', () => {
    const segment = NewsletterSegmentSchema.parse({})
    expect(segment).toEqual({ conditions: [], groups: [] })
    expect(isEmptySegment(segment)).toBe(true)
  })

  it('accepts every condition type', () => {
    const parsed = NewsletterSegmentSchema.parse({
      conditions: [
        { type: 'source', sources: ['FORM', 'IMPORT'] },
        { type: 'subscribed', op: 'before', date: '2026-10-01' },
        { type: 'confirmed', value: true },
        { type: 'opened', op: 'any', lastIssues: '3' },
        { type: 'clicked', op: 'none', lastIssues: 5 },
        { type: 'neverOpened' },
        { type: 'lastOpenedBefore', date: '2026-09-01' },
        { type: 'linkedPerson', value: false },
        { type: 'company', companyIds: ['c1'] },
        { type: 'jobTitle', op: 'contains', value: ' Diretor ' },
        { type: 'city', op: 'equals', value: 'Campinas' },
        {
          type: 'customField',
          definitionId: 'd1',
          op: 'equals',
          value: 'Pro',
        },
        { type: 'customField', definitionId: 'd1', op: 'isSet' },
        { type: 'openOpportunity', value: true },
        { type: 'leadStage', stages: ['QUALIFIED'] },
      ],
      groups: [{ conditions: [{ type: 'neverOpened' }] }],
    })
    expect(parsed.conditions).toHaveLength(15)
    expect(parsed.conditions[3]).toEqual({
      type: 'opened',
      op: 'any',
      lastIssues: 3,
    })
    expect(parsed.conditions[9]).toMatchObject({ value: 'Diretor' })
    expect(isEmptySegment(parsed)).toBe(false)
  })

  it('rejects incomplete or out-of-range conditions', () => {
    const bad = [
      { type: 'source', sources: [] },
      { type: 'subscribed', op: 'before', date: '01/10/2026' },
      { type: 'subscribed', op: 'before', date: '2026-13-45' },
      { type: 'opened', op: 'any', lastIssues: 0 },
      { type: 'opened', op: 'any', lastIssues: 51 },
      { type: 'company', companyIds: [] },
      { type: 'city', op: 'equals', value: '  ' },
      { type: 'customField', definitionId: 'd1', op: 'equals' },
      { type: 'customField', definitionId: 'd1', op: 'contains', value: '' },
      { type: 'leadStage', stages: ['NOPE'] },
      { type: 'unknown' },
    ]
    for (const condition of bad) {
      expect(
        NewsletterSegmentSchema.safeParse({ conditions: [condition] }).success,
        JSON.stringify(condition),
      ).toBe(false)
    }
    expect(
      NewsletterSegmentSchema.safeParse({ groups: [{ conditions: [] }] })
        .success,
    ).toBe(false)
    expect(
      NewsletterSegmentSchema.safeParse({
        conditions: Array.from({ length: 21 }, () => ({ type: 'neverOpened' })),
      }).success,
    ).toBe(false)
    expect(
      NewsletterSegmentSchema.safeParse({
        groups: Array.from({ length: 6 }, () => ({
          conditions: [{ type: 'neverOpened' }],
        })),
      }).success,
    ).toBe(false)
  })
})

describe('segment DTO schemas', () => {
  it('validates saved segments and the issue audience', () => {
    expect(
      CreateCrmNewsletterSegmentSchema.safeParse({
        name: ' Engajados ',
        definition: {},
      }).data?.name,
    ).toBe('Engajados')
    expect(
      CreateCrmNewsletterSegmentSchema.safeParse({ name: '', definition: {} })
        .success,
    ).toBe(false)
    expect(UpdateCrmNewsletterSegmentSchema.safeParse({}).success).toBe(false)
    expect(
      UpdateCrmNewsletterSegmentSchema.safeParse({ name: 'Novo' }).success,
    ).toBe(true)
    expect(
      SetIssueSegmentSchema.parse({ segment: {}, savedSegmentId: null }),
    ).toEqual({
      segment: { conditions: [], groups: [] },
      savedSegmentId: null,
    })
    expect(AudiencePreviewSchema.parse({})).toEqual({})
    expect(StoredIssueSegmentSchema.parse({ savedSegmentId: 's1' })).toEqual({
      conditions: [],
      groups: [],
      savedSegmentId: 's1',
    })
  })

  it('splits the chosen company ids of the options query', () => {
    expect(SegmentOptionsQuerySchema.parse({ companyIds: 'a, b,,c' })).toEqual({
      companyIds: ['a', 'b', 'c'],
    })
    expect(SegmentOptionsQuerySchema.parse({})).toEqual({ companyIds: [] })
  })
})
