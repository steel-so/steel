import { describe, expect, it } from 'vitest'
import { EnrollCrmCadenceSchema } from '@/src/schemas/crm-cadence.schema'
import {
  CrmCustomerFiltersSchema,
  ListCrmCustomersSchema,
} from '@/src/schemas/crm-customer.schema'

describe('ListCrmCustomersSchema', () => {
  it('applies the defaults of an empty query', () => {
    expect(ListCrmCustomersSchema.parse({})).toEqual({
      kind: 'ALL',
      sort: 'lastWonAt',
      dir: 'desc',
      page: 1,
      pageSize: 25,
    })
  })

  it('coerces the query-string numbers', () => {
    const parsed = ListCrmCustomersSchema.parse({
      kind: 'COMPANY',
      minTotal: '1000',
      inactiveDays: '180',
      page: '3',
      hasRenewal: 'yes',
    })
    expect(parsed).toMatchObject({
      kind: 'COMPANY',
      minTotal: 1000,
      inactiveDays: 180,
      page: 3,
      hasRenewal: 'yes',
    })
  })

  it('refuses a min above the max, a bad day and an unknown sort', () => {
    expect(
      ListCrmCustomersSchema.safeParse({ minTotal: '10', maxTotal: '5' })
        .success,
    ).toBe(false)
    expect(
      ListCrmCustomersSchema.safeParse({ wonFrom: '2026-13-40' }).success,
    ).toBe(false)
    expect(ListCrmCustomersSchema.safeParse({ sort: 'password' }).success).toBe(
      false,
    )
    expect(ListCrmCustomersSchema.safeParse({ pageSize: '500' }).success).toBe(
      false,
    )
  })

  it('does not paginate the filters used by the export', () => {
    expect(CrmCustomerFiltersSchema.parse({ q: ' acme ' })).toMatchObject({
      q: 'acme',
    })
  })
})

describe('EnrollCrmCadenceSchema', () => {
  it('still needs a lead or a segment', () => {
    const empty = EnrollCrmCadenceSchema.safeParse({
      cadenceId: 'c1',
      leadIds: [],
    })
    expect(empty.success).toBe(false)
    expect(empty.error?.issues[0]?.message).toBe('Escolha ao menos um lead')
  })

  it('accepts only segments or only leads', () => {
    expect(
      EnrollCrmCadenceSchema.safeParse({ cadenceId: 'c1', segmentIds: ['s1'] })
        .success,
    ).toBe(true)
    expect(
      EnrollCrmCadenceSchema.safeParse({ cadenceId: 'c1', leadIds: ['l1'] })
        .success,
    ).toBe(true)
  })
})
