import { describe, expect, it } from 'vitest'
import {
  ListCrmDuplicatesSchema,
  ListCrmMergesSchema,
  MergeCrmDuplicateSchema,
  ScanCrmDuplicatesSchema,
} from '../crm-duplicate.schema'

describe('crm-duplicate schemas', () => {
  it('defaults the list to pending people, first page', () => {
    expect(ListCrmDuplicatesSchema.parse({})).toEqual({
      entity: 'PERSON',
      status: 'PENDING',
      page: 1,
      pageSize: 20,
    })
  })

  it('coerces and bounds the paging', () => {
    expect(
      ListCrmDuplicatesSchema.parse({ page: '3', pageSize: '50' }),
    ).toMatchObject({ page: 3, pageSize: 50 })
    expect(ListCrmDuplicatesSchema.safeParse({ pageSize: '51' }).success).toBe(
      false,
    )
    expect(ListCrmDuplicatesSchema.safeParse({ entity: 'LEAD' }).success).toBe(
      false,
    )
  })

  it('accepts an optional entity to scan', () => {
    expect(ScanCrmDuplicatesSchema.parse({})).toEqual({})
    expect(ScanCrmDuplicatesSchema.parse({ entity: 'COMPANY' })).toEqual({
      entity: 'COMPANY',
    })
  })

  it('requires the survivor', () => {
    expect(MergeCrmDuplicateSchema.safeParse({}).success).toBe(false)
    expect(
      MergeCrmDuplicateSchema.safeParse({ survivorId: '  ' }).success,
    ).toBe(false)
    expect(MergeCrmDuplicateSchema.parse({ survivorId: 'p1' })).toEqual({
      survivorId: 'p1',
    })
  })

  it('defaults the merge list to people', () => {
    expect(ListCrmMergesSchema.parse({})).toEqual({ entity: 'PERSON' })
  })
})
