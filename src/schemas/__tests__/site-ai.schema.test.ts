import { describe, expect, it } from 'vitest'
import { createSiteDocument } from '@/src/__tests__/factories/site.factory'
import {
  GenerateSiteSchema,
  GenerateSiteSectionSchema,
  RewriteSitePageSchema,
  SITE_AI_GOAL_LABELS,
  SITE_AI_GOALS,
  SITE_AI_MAX_PRODUCTS,
  SITE_AI_MAX_TARGETS,
  SITE_AI_PAGE_KINDS,
  SITE_AI_PAGE_LABELS,
  SITE_AI_TONE_LABELS,
  SITE_AI_TONES,
  SuggestSiteImagesSchema,
} from '../site-ai.schema'

const base = {
  name: '  Pão & Cia ',
  business: 'Padaria artesanal com fermentação natural',
  goal: 'leads',
  tone: 'friendly',
}

describe('GenerateSiteSchema', () => {
  it('applies defaults and dedupes the pages', () => {
    const parsed = GenerateSiteSchema.parse({
      ...base,
      pages: ['about', 'about', 'contact'],
      primaryColor: '#AA3300',
      logoUrl: 'https://cdn.example.com/logo.png',
      eventDate: '2026-12-01',
    })
    expect(parsed).toMatchObject({
      name: 'Pão & Cia',
      audience: '',
      pages: ['about', 'contact'],
      style: 'auto',
      productIds: [],
      useTestimonials: true,
      createContactForm: false,
      extra: '',
    })
  })

  it('accepts a same-origin logo path', () => {
    expect(
      GenerateSiteSchema.safeParse({ ...base, logoUrl: '/media/logo.png' })
        .success,
    ).toBe(true)
  })

  it.each([
    [{ business: 'curto' }, 'business'],
    [{ name: '' }, 'name'],
    [{ goal: 'fame' }, 'goal'],
    [{ primaryColor: 'red' }, 'primaryColor'],
    [{ logoUrl: 'http://insecure.com/x.png' }, 'logoUrl'],
    [{ logoUrl: '//evil.com/x.png' }, 'logoUrl'],
    [{ logoUrl: 'javascript:alert(1)' }, 'logoUrl'],
    [{ pages: ['blog'] }, 'pages'],
    [{ eventDate: '01/12/2026' }, 'eventDate'],
    [
      {
        productIds: Array.from(
          { length: SITE_AI_MAX_PRODUCTS + 1 },
          (_, i) => `p${i}`,
        ),
      },
      'productIds',
    ],
    [{ contactFormId: 'f1', createContactForm: true }, 'contactFormId'],
  ])('rejects %j', (input, field) => {
    const parsed = GenerateSiteSchema.safeParse({ ...base, ...input })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0].path[0]).toBe(field)
  })
})

describe('editor schemas', () => {
  it('requires a prompt for a section and fills the context', () => {
    expect(
      GenerateSiteSectionSchema.parse({ prompt: 'Três serviços' }),
    ).toEqual({
      prompt: 'Três serviços',
      style: 'auto',
      pageTitle: '',
      headings: [],
    })
    expect(GenerateSiteSectionSchema.safeParse({ prompt: 'a' }).success).toBe(
      false,
    )
  })

  it('takes the document, tone and targets of a rewrite', () => {
    const parsed = RewriteSitePageSchema.parse({
      document: createSiteDocument(),
      tone: 'formal',
    })
    expect(parsed).toMatchObject({
      length: 'same',
      instructions: '',
      nodeIds: [],
    })
    expect(
      RewriteSitePageSchema.safeParse({
        document: createSiteDocument(),
        tone: 'formal',
        nodeIds: Array.from({ length: SITE_AI_MAX_TARGETS + 1 }, () => 'x'),
      }).success,
    ).toBe(false)
    expect(
      RewriteSitePageSchema.safeParse({ document: {}, tone: 'formal' }).success,
    ).toBe(false)
  })

  it('takes the document of an image suggestion', () => {
    expect(
      SuggestSiteImagesSchema.parse({ document: createSiteDocument() }).nodeIds,
    ).toEqual([])
  })
})

describe('labels', () => {
  it('has a pt-BR label for every option', () => {
    for (const goal of SITE_AI_GOALS)
      expect(SITE_AI_GOAL_LABELS[goal]).toBeTruthy()
    for (const tone of SITE_AI_TONES)
      expect(SITE_AI_TONE_LABELS[tone]).toBeTruthy()
    for (const kind of SITE_AI_PAGE_KINDS) {
      expect(SITE_AI_PAGE_LABELS[kind]).toBeTruthy()
    }
    expect(SITE_AI_PAGE_LABELS.home).toBe('Início')
  })
})
