import { describe, expect, it } from 'vitest'
import {
  CreateSdLicenseSchema,
  ListSdLicensesQuerySchema,
  SetSdLicenseAssetsSchema,
  UpdateSdLicenseSchema,
} from '../sd-license.schema'

const valid = { name: ' Office ', matchPattern: 'Office', seats: 10 }

describe('CreateSdLicenseSchema', () => {
  it('applies defaults and normalizes dates and blanks', () => {
    const parsed = CreateSdLicenseSchema.parse({
      ...valid,
      vendor: '',
      expiresAt: '2027-01-10',
      purchasedAt: '2026-01-10T12:00:00Z',
    })
    expect(parsed.name).toBe('Office')
    expect(parsed.vendor).toBeNull()
    expect(parsed.renewalNoticeDays).toBe(30)
    expect(parsed.expiresAt?.toISOString()).toBe('2027-01-10T00:00:00.000Z')
    expect(parsed.purchasedAt?.toISOString()).toBe('2026-01-10T00:00:00.000Z')
  })

  it.each([
    { ...valid, name: '' },
    { ...valid, matchPattern: 'x' },
    { ...valid, seats: -1 },
    { ...valid, seats: 1.5 },
    { ...valid, expiresAt: '10/01/2027' },
    { ...valid, expiresAt: '2027-13-45' },
    { ...valid, renewalNoticeDays: 400 },
  ])('rejects %o', (input) => {
    expect(CreateSdLicenseSchema.safeParse(input).success).toBe(false)
  })
})

describe('UpdateSdLicenseSchema', () => {
  it('accepts a partial and refuses an empty body', () => {
    expect(UpdateSdLicenseSchema.parse({ seats: 3 })).toEqual({ seats: 3 })
    expect(UpdateSdLicenseSchema.safeParse({}).success).toBe(false)
  })
})

describe('ListSdLicensesQuerySchema', () => {
  it('reads the boolean flag and the status', () => {
    expect(
      ListSdLicensesQuerySchema.parse({
        includeArchived: 'true',
        status: 'EXPIRING',
      }),
    ).toEqual({ includeArchived: true, status: 'EXPIRING' })
    expect(ListSdLicensesQuerySchema.parse({}).includeArchived).toBe(false)
    expect(ListSdLicensesQuerySchema.safeParse({ status: 'X' }).success).toBe(
      false,
    )
  })
})

describe('SetSdLicenseAssetsSchema', () => {
  it('needs a list of ids', () => {
    expect(SetSdLicenseAssetsSchema.parse({ configItemIds: ['a'] })).toEqual({
      configItemIds: ['a'],
    })
    expect(SetSdLicenseAssetsSchema.safeParse({}).success).toBe(false)
  })
})
