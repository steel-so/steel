import { describe, expect, it } from 'vitest'
import {
  BANNER_TEMPLATES,
  buildBannerDocument,
} from '@/src/lib/banners/templates'
import {
  BannerAiBriefSchema,
  BannerAiOutputSchema,
  CreateCrmBannerSchema,
  UpdateCrmBannerSchema,
} from '../crm-banner.schema'

const template = BANNER_TEMPLATES[0]
if (!template) throw new Error('no template')
const document = buildBannerDocument({
  template,
  brand: { companyName: 'Acme', logoUrl: '', primaryColor: '#2563eb' },
  formatIds: ['gdn-300x250', 'meta-1080x1080'],
})

describe('CreateCrmBannerSchema', () => {
  it('accepts a generated document and fills the defaults', () => {
    const parsed = CreateCrmBannerSchema.parse({ name: ' Verão ', document })
    expect(parsed.name).toBe('Verão')
    expect(parsed.folder).toBe('')
    expect(parsed.tags).toEqual([])
    expect(parsed.objective).toBeNull()
  })

  it('requires a name', () => {
    const result = CreateCrmBannerSchema.safeParse({ name: '  ', document })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Informe o nome do banner')
  })

  it('requires at least one format', () => {
    expect(
      CreateCrmBannerSchema.safeParse({
        name: 'x',
        document: { version: 1, formats: [] },
      }).success,
    ).toBe(false)
  })

  it('rejects invalid colors and unknown element types', () => {
    const broken = structuredClone(document)
    const first = broken.formats[0]
    if (!first) throw new Error('format')
    first.background = { kind: 'color', color: 'red' }
    expect(
      CreateCrmBannerSchema.safeParse({ name: 'x', document: broken }).success,
    ).toBe(false)

    const unknown = structuredClone(document) as unknown as {
      formats: Array<{ elements: Array<Record<string, unknown>> }>
    }
    unknown.formats[0]?.elements.push({ id: 'z', type: 'video' })
    expect(
      CreateCrmBannerSchema.safeParse({ name: 'x', document: unknown }).success,
    ).toBe(false)
  })

  it('dedupes tags and caps them at 10', () => {
    const parsed = CreateCrmBannerSchema.parse({
      name: 'x',
      document,
      tags: ['a', 'a', 'b'],
    })
    expect(parsed.tags).toEqual(['a', 'b'])
    expect(
      CreateCrmBannerSchema.safeParse({
        name: 'x',
        document,
        tags: Array.from({ length: 11 }, (_, i) => `t${i}`),
      }).success,
    ).toBe(false)
  })

  it('limits the number of formats', () => {
    const format = document.formats[0]
    if (!format) throw new Error('format')
    const many = {
      version: 1,
      formats: Array.from({ length: 21 }, () => format),
    }
    expect(
      CreateCrmBannerSchema.safeParse({ name: 'x', document: many }).success,
    ).toBe(false)
  })
})

describe('UpdateCrmBannerSchema', () => {
  it('needs at least one field', () => {
    expect(UpdateCrmBannerSchema.safeParse({}).success).toBe(false)
    expect(UpdateCrmBannerSchema.safeParse({ folder: 'Verão' }).success).toBe(
      true,
    )
  })

  it('accepts clearing the objective', () => {
    expect(UpdateCrmBannerSchema.parse({ objective: null })).toEqual({
      objective: null,
    })
  })
})

describe('BannerAiBriefSchema', () => {
  it('defaults tone, count and empty fields', () => {
    const parsed = BannerAiBriefSchema.parse({ mode: 'BANNER' })
    expect(parsed).toMatchObject({
      tone: 'DIRECT',
      count: 3,
      headline: '',
      offer: '',
      objective: null,
    })
  })

  it('bounds the number of variants and the briefing size', () => {
    expect(
      BannerAiBriefSchema.safeParse({ mode: 'VARIANTS', count: 6 }).success,
    ).toBe(false)
    expect(
      BannerAiBriefSchema.safeParse({
        mode: 'BANNER',
        description: 'x'.repeat(601),
      }).success,
    ).toBe(false)
  })

  it('validates the structured AI output', () => {
    expect(
      BannerAiOutputSchema.safeParse({
        imageIdea: '',
        variants: [{ headline: 'a', subheadline: '', cta: 'b', badge: '' }],
      }).success,
    ).toBe(true)
    expect(
      BannerAiOutputSchema.safeParse({ imageIdea: '', variants: [] }).success,
    ).toBe(false)
  })
})
