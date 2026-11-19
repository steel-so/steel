import { describe, expect, it } from 'vitest'
import {
  buildCompleteness,
  buildLocationPatch,
  formatAddress,
  mapLocationToProfile,
  mergeWithCurrent,
  periodsFromGoogle,
  periodsToGoogle,
  sortPeriods,
  stringToTime,
  timeToString,
  validatePeriods,
} from '@/src/lib/google-business/profile'
import type { GoogleHoursPeriodDTO } from '@/src/schemas/crm-google-presence.schema'
import { UpdateGoogleProfileSchema } from '@/src/schemas/crm-google-presence.schema'

describe('time conversion', () => {
  it('pads hours and minutes, defaulting missing fields to zero', () => {
    expect(timeToString({ hours: 8, minutes: 5 })).toBe('08:05')
    expect(timeToString({ hours: 18 })).toBe('18:00')
    expect(timeToString(undefined)).toBe('00:00')
  })

  it('parses HH:MM back to Google time of day', () => {
    expect(stringToTime('09:30')).toEqual({ hours: 9, minutes: 30 })
    expect(stringToTime('24:00')).toEqual({ hours: 24, minutes: 0 })
  })
})

describe('periods', () => {
  it('maps Google periods and drops unknown weekdays', () => {
    const periods = periodsFromGoogle([
      {
        openDay: 'MONDAY',
        openTime: { hours: 9 },
        closeDay: 'MONDAY',
        closeTime: { hours: 18 },
      },
      { openDay: 'FUNDAY', openTime: { hours: 1 }, closeTime: { hours: 2 } },
    ])
    expect(periods).toEqual([{ day: 'MONDAY', open: '09:00', close: '18:00' }])
  })

  it('sorts by weekday then opening time', () => {
    const sorted = sortPeriods([
      { day: 'TUESDAY', open: '09:00', close: '12:00' },
      { day: 'MONDAY', open: '14:00', close: '18:00' },
      { day: 'MONDAY', open: '08:00', close: '12:00' },
    ])
    expect(sorted.map((p) => `${p.day}-${p.open}`)).toEqual([
      'MONDAY-08:00',
      'MONDAY-14:00',
      'TUESDAY-09:00',
    ])
  })

  it('round-trips to the Google shape', () => {
    const periods: GoogleHoursPeriodDTO[] = [
      { day: 'FRIDAY', open: '09:00', close: '17:30' },
    ]
    expect(periodsToGoogle(periods)).toEqual([
      {
        openDay: 'FRIDAY',
        openTime: { hours: 9, minutes: 0 },
        closeDay: 'FRIDAY',
        closeTime: { hours: 17, minutes: 30 },
      },
    ])
  })

  it('rejects closing before opening and overlapping periods', () => {
    expect(
      validatePeriods([{ day: 'MONDAY', open: '18:00', close: '09:00' }]),
    ).toMatch(/depois/)
    expect(
      validatePeriods([
        { day: 'MONDAY', open: '08:00', close: '12:00' },
        { day: 'MONDAY', open: '11:00', close: '18:00' },
      ]),
    ).toMatch(/sobrepor/)
  })

  it('accepts split shifts and 24:00', () => {
    expect(
      validatePeriods([
        { day: 'MONDAY', open: '08:00', close: '12:00' },
        { day: 'MONDAY', open: '14:00', close: '24:00' },
      ]),
    ).toBeNull()
  })
})

describe('formatAddress', () => {
  it('joins the address parts in a readable order', () => {
    expect(
      formatAddress({
        addressLines: ['Av. Paulista, 1000'],
        locality: 'São Paulo',
        administrativeArea: 'SP',
        postalCode: '01310-100',
      }),
    ).toBe('Av. Paulista, 1000, São Paulo - SP, 01310-100')
  })

  it('returns null without an address', () => {
    expect(formatAddress(undefined)).toBeNull()
    expect(formatAddress({})).toBeNull()
  })
})

describe('buildCompleteness', () => {
  const complete = {
    title: 'Padaria Central',
    primaryCategory: { name: 'categories/gcid:bakery', displayName: 'Padaria' },
    description: 'x'.repeat(300),
    primaryPhone: '+55 11 3000-0000',
    websiteUri: 'https://padaria.com.br',
    hours: [{ day: 'MONDAY' as const, open: '08:00', close: '18:00' }],
    address: 'Rua A, 1',
    photoCount: 8,
    attributesFilled: 3,
  }

  it('scores 100 when everything is filled', () => {
    const result = buildCompleteness(complete)
    expect(result.score).toBe(100)
    expect(result.items.every((item) => item.done)).toBe(true)
  })

  it('lists what is missing and scores proportionally', () => {
    const result = buildCompleteness({
      ...complete,
      description: 'curta',
      websiteUri: null,
      photoCount: 2,
    })
    const missing = result.items.filter((i) => !i.done).map((i) => i.key)
    expect(missing).toEqual(['description', 'website', 'photos'])
    expect(result.score).toBe(67)
  })

  it('treats unknown photo and attribute counts as missing', () => {
    const result = buildCompleteness({
      ...complete,
      photoCount: null,
      attributesFilled: null,
    })
    expect(result.items.filter((i) => !i.done).map((i) => i.key)).toEqual([
      'photos',
      'attributes',
    ])
  })
})

describe('mapLocationToProfile', () => {
  it('maps a Google location and computes completeness', () => {
    const profile = mapLocationToProfile(
      {
        name: 'locations/1',
        title: 'Loja',
        phoneNumbers: { primaryPhone: '(11) 1111-1111' },
        categories: {
          primaryCategory: {
            name: 'categories/gcid:store',
            displayName: 'Loja',
          },
        },
        latlng: { latitude: -23.5, longitude: -46.6 },
        metadata: { placeId: 'abc', mapsUri: 'https://maps.google.com/?cid=1' },
      },
      { photoCount: 0, attributesFilled: 0 },
    )
    expect(profile.title).toBe('Loja')
    expect(profile.primaryCategory?.displayName).toBe('Loja')
    expect(profile.placeId).toBe('abc')
    expect(profile.latitude).toBe(-23.5)
    expect(profile.completeness.score).toBeLessThan(100)
  })
})

describe('mergeWithCurrent and buildLocationPatch', () => {
  const current = {
    primaryPhone: '111',
    additionalPhones: ['222'],
    primaryCategory: { name: 'categories/gcid:a', displayName: 'A' },
    additionalCategories: [{ name: 'categories/gcid:b', displayName: 'B' }],
  }

  it('keeps the primary phone when only additional phones change', () => {
    const merged = mergeWithCurrent({ additionalPhones: ['333'] }, current)
    expect(merged.primaryPhone).toBe('111')
    expect(merged.additionalPhones).toEqual(['333'])
  })

  it('keeps the primary category when only additional ones change', () => {
    const merged = mergeWithCurrent(
      { additionalCategoryNames: ['categories/gcid:c'] },
      current,
    )
    expect(merged.primaryCategoryName).toBe('categories/gcid:a')
  })

  it('leaves untouched fields alone', () => {
    expect(mergeWithCurrent({ title: 'Novo' }, current)).toEqual({
      title: 'Novo',
    })
  })

  it('builds a mask with only the changed fields', () => {
    const { updateMask, body } = buildLocationPatch({
      title: 'Novo nome',
      description: 'Desc',
      websiteUri: '',
      hours: [{ day: 'MONDAY', open: '09:00', close: '18:00' }],
    })
    expect(updateMask).toEqual([
      'title',
      'profile',
      'websiteUri',
      'regularHours',
    ])
    expect(body.title).toBe('Novo nome')
    expect(body.profile).toEqual({ description: 'Desc' })
    expect(body.websiteUri).toBe('')
    expect(body.regularHours?.periods).toHaveLength(1)
  })

  it('clears the primary phone when null', () => {
    const { updateMask, body } = buildLocationPatch({ primaryPhone: null })
    expect(updateMask).toEqual(['phoneNumbers'])
    expect(body.phoneNumbers).toEqual({})
  })
})

describe('UpdateGoogleProfileSchema', () => {
  it('requires at least one field', () => {
    expect(UpdateGoogleProfileSchema.safeParse({}).success).toBe(false)
  })

  it('caps the description at 750 characters', () => {
    expect(
      UpdateGoogleProfileSchema.safeParse({ description: 'x'.repeat(751) })
        .success,
    ).toBe(false)
    expect(
      UpdateGoogleProfileSchema.safeParse({ description: 'x'.repeat(750) })
        .success,
    ).toBe(true)
  })

  it('validates site and hours', () => {
    expect(
      UpdateGoogleProfileSchema.safeParse({ websiteUri: 'sem-protocolo' })
        .success,
    ).toBe(false)
    expect(
      UpdateGoogleProfileSchema.safeParse({
        hours: [{ day: 'MONDAY', open: '9h', close: '18:00' }],
      }).success,
    ).toBe(false)
    expect(
      UpdateGoogleProfileSchema.safeParse({
        websiteUri: 'https://a.com',
        hours: [{ day: 'MONDAY', open: '09:00', close: '24:00' }],
      }).success,
    ).toBe(true)
  })
})
