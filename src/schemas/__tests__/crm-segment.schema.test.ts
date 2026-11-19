import { describe, expect, it } from 'vitest'
import {
  CreateCrmSegmentSchema,
  PreviewCrmSegmentSchema,
  UpdateCrmSegmentSchema,
  validateSegmentDefinition,
} from '@/src/schemas/crm-segment.schema'

const base = {
  name: 'Leads quentes',
  target: 'LEAD' as const,
  definition: {
    conditions: [{ type: 'leadStage', stages: ['QUALIFIED'] }],
  },
}

describe('CreateCrmSegmentSchema', () => {
  it('accepts a valid segment and fills the defaults', () => {
    const parsed = CreateCrmSegmentSchema.parse(base)
    expect(parsed.definition.match).toBe('ALL')
    expect(parsed.definition.groups).toEqual([])
  })

  it('requires a name', () => {
    expect(
      CreateCrmSegmentSchema.safeParse({ ...base, name: '  ' }).success,
    ).toBe(false)
  })

  it('refuses a rule that does not fit the target', () => {
    const result = CreateCrmSegmentSchema.safeParse({
      ...base,
      target: 'PERSON',
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(
      'Há uma regra que não vale para este tipo de contato',
    )
  })

  it('refuses text rules without a value', () => {
    const result = CreateCrmSegmentSchema.safeParse({
      ...base,
      definition: {
        conditions: [{ type: 'text', field: 'city', op: 'contains' }],
      },
    })
    expect(result.success).toBe(false)
  })

  it('accepts "isSet" without a value and refuses "contains" on e-mail', () => {
    const set = CreateCrmSegmentSchema.safeParse({
      ...base,
      definition: {
        conditions: [{ type: 'text', field: 'email', op: 'isSet' }],
      },
    })
    expect(set.success).toBe(true)
    const contains = CreateCrmSegmentSchema.safeParse({
      ...base,
      definition: {
        conditions: [
          { type: 'text', field: 'email', op: 'contains', value: 'gmail' },
        ],
      },
    })
    expect(contains.success).toBe(false)
  })

  it('refuses empty pickers and out-of-range days', () => {
    expect(
      PreviewCrmSegmentSchema.safeParse({
        target: 'PERSON',
        definition: { conditions: [{ type: 'company', companyIds: [] }] },
      }).success,
    ).toBe(false)
    expect(
      PreviewCrmSegmentSchema.safeParse({
        target: 'PERSON',
        definition: {
          conditions: [{ type: 'activity', op: 'withinDays', days: 0 }],
        },
      }).success,
    ).toBe(false)
  })

  it('accepts groups with their own match', () => {
    const result = PreviewCrmSegmentSchema.safeParse({
      target: 'COMPANY',
      definition: {
        match: 'ANY',
        conditions: [],
        groups: [
          {
            match: 'ALL',
            conditions: [
              { type: 'number', field: 'employees', op: 'gte', value: 10 },
              { type: 'deals', kind: 'won', has: true, withinDays: 365 },
            ],
          },
        ],
      },
    })
    expect(result.success).toBe(true)
  })
})

describe('UpdateCrmSegmentSchema', () => {
  it('needs at least one field', () => {
    expect(UpdateCrmSegmentSchema.safeParse({}).success).toBe(false)
    expect(UpdateCrmSegmentSchema.safeParse({ name: 'Novo' }).success).toBe(
      true,
    )
  })
})

describe('validateSegmentDefinition', () => {
  it('flags a number field of another target', () => {
    expect(
      validateSegmentDefinition('PERSON', {
        match: 'ALL',
        groups: [],
        conditions: [{ type: 'number', field: 'score', op: 'gte', value: 1 }],
      }),
    ).not.toBeNull()
  })
})
