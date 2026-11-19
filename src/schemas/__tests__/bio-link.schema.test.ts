import { describe, expect, it } from 'vitest'
import {
  BioAnalyticsQuerySchema,
  BioBlocksSchema,
  BioSlugSchema,
  BioThemeSchema,
  CreateBioLinkSchema,
  DEFAULT_BIO_THEME,
  MAX_BIO_BLOCKS,
  parseBioBlocks,
  parseBioTheme,
  UpdateBioLinkSchema,
} from '../bio-link.schema'

const link = (overrides: Record<string, unknown> = {}) => ({
  id: 'a',
  type: 'link',
  network: 'whatsapp',
  title: 'Fale conosco',
  value: '(11) 91234-5678',
  ...overrides,
})

describe('BioSlugSchema', () => {
  it('accepts lowercase words with hyphens and lowercases the input', () => {
    expect(BioSlugSchema.parse('Minha-Loja')).toBe('minha-loja')
    expect(BioSlugSchema.parse('loja-2')).toBe('loja-2')
  })

  it('rejects short, long and malformed slugs', () => {
    expect(BioSlugSchema.safeParse('ab').success).toBe(false)
    expect(BioSlugSchema.safeParse('a'.repeat(41)).success).toBe(false)
    expect(BioSlugSchema.safeParse('-loja').success).toBe(false)
    expect(BioSlugSchema.safeParse('loja--x').success).toBe(false)
    expect(BioSlugSchema.safeParse('loja_x').success).toBe(false)
    expect(BioSlugSchema.safeParse('lójá').success).toBe(false)
  })
})

describe('BioThemeSchema', () => {
  it('fills every field with a default', () => {
    expect(BioThemeSchema.parse({})).toEqual(DEFAULT_BIO_THEME)
    expect(DEFAULT_BIO_THEME).toMatchObject({
      buttonStyle: 'solid',
      radius: 'lg',
      font: 'sans',
    })
  })

  it('rejects colors that are not #RRGGBB', () => {
    expect(BioThemeSchema.safeParse({ textColor: 'red' }).success).toBe(false)
    expect(BioThemeSchema.safeParse({ textColor: '#fff' }).success).toBe(false)
  })

  it('falls back to the default for a broken stored theme', () => {
    expect(parseBioTheme({ radius: 'enorme' })).toEqual(DEFAULT_BIO_THEME)
    expect(parseBioTheme(null)).toEqual(DEFAULT_BIO_THEME)
    expect(parseBioTheme({ radius: 'full' }).radius).toBe('full')
  })
})

describe('BioBlocksSchema', () => {
  it('accepts every block type', () => {
    const result = BioBlocksSchema.safeParse([
      link(),
      { id: 'h', type: 'header', title: 'Novidades' },
      { id: 'f', type: 'form', title: 'Contato', formToken: 'tok' },
      {
        id: 'v',
        type: 'video',
        url: 'https://youtu.be/dQw4w9WgXcQ',
      },
    ])
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data[0]).toMatchObject({ active: true })
      expect(result.data[2]).toMatchObject({ mode: 'link' })
    }
  })

  it('rejects a destination that does not fit the network', () => {
    const result = BioBlocksSchema.safeParse([link({ value: 'abc' })])
    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.error.issues[0].path).toEqual([0, 'value'])

    expect(
      BioBlocksSchema.safeParse([
        link({ network: 'custom', value: 'javascript:alert(1)' }),
      ]).success,
    ).toBe(false)
  })

  it('rejects a video that is not from YouTube', () => {
    expect(
      BioBlocksSchema.safeParse([
        { id: 'v', type: 'video', url: 'https://vimeo.com/123456789' },
      ]).success,
    ).toBe(false)
  })

  it('rejects duplicate ids and inverted schedules', () => {
    expect(BioBlocksSchema.safeParse([link(), link()]).success).toBe(false)
    expect(
      BioBlocksSchema.safeParse([
        link({
          startsAt: '2026-11-20T10:00:00.000Z',
          endsAt: '2026-11-19T10:00:00.000Z',
        }),
      ]).success,
    ).toBe(false)
    expect(
      BioBlocksSchema.safeParse([
        link({
          startsAt: '2026-11-19T10:00:00.000Z',
          endsAt: '2026-11-20T10:00:00.000Z',
        }),
      ]).success,
    ).toBe(true)
  })

  it('caps the number of blocks', () => {
    const many = Array.from({ length: MAX_BIO_BLOCKS + 1 }, (_, index) =>
      link({ id: `b${index}` }),
    )
    expect(BioBlocksSchema.safeParse(many).success).toBe(false)
  })

  it('parseBioBlocks drops what no longer validates', () => {
    const kept = parseBioBlocks([link(), { id: 'x', type: 'unknown' }, 3])
    expect(kept).toHaveLength(1)
    expect(parseBioBlocks('nope')).toEqual([])
  })
})

describe('page inputs', () => {
  it('creates with a name and an optional slug', () => {
    expect(CreateBioLinkSchema.safeParse({ name: 'Loja' }).success).toBe(true)
    expect(
      CreateBioLinkSchema.safeParse({ name: 'Loja', slug: 'minha-loja' })
        .success,
    ).toBe(true)
    expect(CreateBioLinkSchema.safeParse({ name: '  ' }).success).toBe(false)
  })

  it('updates partially and only accepts https avatars', () => {
    expect(UpdateBioLinkSchema.safeParse({}).success).toBe(true)
    expect(UpdateBioLinkSchema.safeParse({ status: 'PUBLISHED' }).success).toBe(
      true,
    )
    expect(UpdateBioLinkSchema.safeParse({ status: 'ARCHIVED' }).success).toBe(
      false,
    )
    expect(
      UpdateBioLinkSchema.safeParse({ avatarUrl: 'http://a.com/x.png' })
        .success,
    ).toBe(false)
    expect(
      UpdateBioLinkSchema.safeParse({ avatarUrl: 'https://a.com/x.png' })
        .success,
    ).toBe(true)
    expect(UpdateBioLinkSchema.safeParse({ avatarUrl: null }).success).toBe(
      true,
    )
  })

  it('accepts only the supported analytics periods', () => {
    expect(BioAnalyticsQuerySchema.parse({}).days).toBe(30)
    expect(BioAnalyticsQuerySchema.parse({ days: '7' }).days).toBe(7)
    expect(BioAnalyticsQuerySchema.safeParse({ days: '15' }).success).toBe(
      false,
    )
  })
})
