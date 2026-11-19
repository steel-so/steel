import { describe, expect, it } from 'vitest'
import {
  GoogleDeletePhotoSchema,
  GooglePerformanceQuerySchema,
  ListGoogleReviewsQuerySchema,
  ReplyGoogleReviewSchema,
  SearchGoogleCategoriesSchema,
  SelectGoogleLocationSchema,
  UpdateGoogleAttributesSchema,
  UpdateGoogleSettingsSchema,
} from '@/src/schemas/crm-google-presence.schema'

describe('SelectGoogleLocationSchema', () => {
  it('accepts Google resource names only', () => {
    expect(
      SelectGoogleLocationSchema.safeParse({
        accountName: 'accounts/123',
        locationName: 'locations/456',
      }).success,
    ).toBe(true)
    expect(
      SelectGoogleLocationSchema.safeParse({
        accountName: '../etc',
        locationName: 'locations/456',
      }).success,
    ).toBe(false)
    expect(
      SelectGoogleLocationSchema.safeParse({
        accountName: 'accounts/123',
        locationName: 'accounts/456',
      }).success,
    ).toBe(false)
  })
})

describe('ListGoogleReviewsQuerySchema', () => {
  it('defaults the page and coerces the query strings', () => {
    expect(ListGoogleReviewsQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
    })
    expect(
      ListGoogleReviewsQuerySchema.parse({
        page: '2',
        pageSize: '10',
        rating: '1',
        replied: 'no',
        q: ' atraso ',
      }),
    ).toEqual({ page: 2, pageSize: 10, rating: 1, replied: 'no', q: 'atraso' })
  })

  it('rejects out-of-range values', () => {
    expect(
      ListGoogleReviewsQuerySchema.safeParse({ rating: '6' }).success,
    ).toBe(false)
    expect(
      ListGoogleReviewsQuerySchema.safeParse({ pageSize: '500' }).success,
    ).toBe(false)
    expect(
      ListGoogleReviewsQuerySchema.safeParse({ replied: 'maybe' }).success,
    ).toBe(false)
  })
})

describe('ReplyGoogleReviewSchema', () => {
  it('trims, requires text and caps at 4096 characters', () => {
    expect(
      ReplyGoogleReviewSchema.parse({ comment: '  Obrigado!  ' }).comment,
    ).toBe('Obrigado!')
    expect(ReplyGoogleReviewSchema.safeParse({ comment: '   ' }).success).toBe(
      false,
    )
    expect(
      ReplyGoogleReviewSchema.safeParse({ comment: 'x'.repeat(4097) }).success,
    ).toBe(false)
  })
})

describe('other inputs', () => {
  it('defaults the performance range to 28 days', () => {
    expect(GooglePerformanceQuerySchema.parse({}).range).toBe('28d')
    expect(
      GooglePerformanceQuerySchema.safeParse({ range: '1y' }).success,
    ).toBe(false)
  })

  it('needs 2+ letters to search categories', () => {
    expect(SearchGoogleCategoriesSchema.safeParse({ q: 'p' }).success).toBe(
      false,
    )
    expect(
      SearchGoogleCategoriesSchema.safeParse({ q: 'Pizzaria' }).success,
    ).toBe(true)
  })

  it('accepts a null tone to clear it and caps its size', () => {
    expect(
      UpdateGoogleSettingsSchema.safeParse({ replyTone: null }).success,
    ).toBe(true)
    expect(
      UpdateGoogleSettingsSchema.safeParse({ replyTone: 'x'.repeat(501) })
        .success,
    ).toBe(false)
  })

  it('validates attribute names and requires changes', () => {
    expect(
      UpdateGoogleAttributesSchema.safeParse({
        attributes: [{ name: 'attributes/has_wifi', value: true }],
      }).success,
    ).toBe(true)
    expect(
      UpdateGoogleAttributesSchema.safeParse({ attributes: [] }).success,
    ).toBe(false)
    expect(
      UpdateGoogleAttributesSchema.safeParse({
        attributes: [{ name: 'has_wifi', value: true }],
      }).success,
    ).toBe(false)
  })

  it('only deletes media resource names', () => {
    expect(
      GoogleDeletePhotoSchema.safeParse({
        name: 'accounts/1/locations/2/media/3',
      }).success,
    ).toBe(true)
    expect(
      GoogleDeletePhotoSchema.safeParse({ name: 'https://x' }).success,
    ).toBe(false)
  })
})
