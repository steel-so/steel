import { describe, expect, it } from 'vitest'
import { applyCopy, readCopy } from '@/src/lib/banners/document'
import {
  BANNER_FORMATS,
  classifyShape,
  DEFAULT_FORMAT_IDS,
  findBannerFormat,
} from '@/src/lib/banners/formats'
import {
  type BannerContent,
  estimateLines,
  fitFontSize,
} from '@/src/lib/banners/layout'
import {
  inferContent,
  inferStyle,
  reflowDocument,
  reflowFormat,
  reflowProportional,
} from '@/src/lib/banners/reflow'
import {
  BANNER_TEMPLATES,
  buildBannerDocument,
  luminance,
  mixColors,
  readableOn,
  templatesForObjective,
} from '@/src/lib/banners/templates'
import {
  BannerDocumentSchema,
  type BannerFormat,
} from '@/src/schemas/crm-banner.schema'

const BRAND = {
  companyName: 'Acme',
  logoUrl: 'https://cdn.example.com/logo.png',
  primaryColor: '#e11d48',
}

const COPY: Partial<BannerContent> = {
  headline: 'Fibra ultrarrápida para a sua empresa',
  subheadline: 'Instalação grátis em até 48 horas.',
  cta: 'Quero contratar',
  badge: 'Novo',
}

function build(templateId: string, formatIds: string[], imageUrl = '') {
  const template = BANNER_TEMPLATES.find((t) => t.id === templateId)
  if (!template) throw new Error(`template ${templateId}`)
  return buildBannerDocument({
    template,
    brand: BRAND,
    formatIds,
    copy: COPY,
    imageUrl,
  })
}

function inside(format: BannerFormat) {
  return format.elements.every(
    (e) =>
      e.hidden ||
      // Decorative shapes bleed off the canvas on purpose.
      e.role === 'decor' ||
      (e.x >= -1 &&
        e.y >= -1 &&
        e.x + e.w <= format.width + 1 &&
        e.y + e.h <= format.height + 1),
  )
}

describe('format catalog', () => {
  it('has unique ids and the formats the brief lists', () => {
    const ids = BANNER_FORMATS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const size of [
      '300x250',
      '336x280',
      '728x90',
      '970x90',
      '970x250',
      '160x600',
      '300x600',
      '320x50',
      '320x100',
    ]) {
      expect(ids).toContain(`gdn-${size}`)
    }
    expect(findBannerFormat('meta-1080x1350')?.height).toBe(1350)
    expect(findBannerFormat('yt-1280x720')?.width).toBe(1280)
    expect(findBannerFormat('tiktok-1080x1920')?.safeBottom).toBeGreaterThan(0)
  })

  it('sets the 150 KB target on Google Display only', () => {
    expect(findBannerFormat('gdn-300x250')?.targetKb).toBe(150)
    expect(findBannerFormat('meta-1080x1080')?.targetKb).toBeNull()
  })

  it('classifies the aspect ratio families', () => {
    expect(classifyShape(728, 90)).toBe('strip')
    expect(classifyShape(320, 100)).toBe('strip')
    expect(classifyShape(1280, 720)).toBe('wide')
    expect(classifyShape(300, 250)).toBe('square')
    expect(classifyShape(1080, 1080)).toBe('square')
    expect(classifyShape(1080, 1350)).toBe('portrait')
    expect(classifyShape(1080, 1920)).toBe('portrait')
    expect(classifyShape(160, 600)).toBe('tall')
  })

  it('defaults only to known formats', () => {
    for (const id of DEFAULT_FORMAT_IDS)
      expect(findBannerFormat(id)).toBeDefined()
  })
})

describe('text metrics', () => {
  it('counts wrapped lines and honors explicit breaks', () => {
    expect(estimateLines('Olá', 20, 400)).toBe(1)
    expect(estimateLines('Olá\nmundo', 20, 400)).toBe(2)
    expect(
      estimateLines('palavra '.repeat(20).trim(), 20, 200),
    ).toBeGreaterThan(5)
  })

  it('shrinks the font until the text fits the box', () => {
    const text = 'Uma frase longa que não cabe em uma caixa pequena de texto'
    const size = fitFontSize(text, 160, 60, 48, 8, 1.1)
    expect(size).toBeLessThan(48)
    expect(estimateLines(text, size, 160) * size * 1.1).toBeLessThanOrEqual(
      60.5,
    )
  })

  it('never goes below the minimum', () => {
    expect(fitFontSize('x '.repeat(500), 50, 10, 40, 9, 1.1)).toBe(9)
  })
})

describe('colors', () => {
  it('picks a readable text color', () => {
    expect(readableOn('#ffffff')).toBe('#111111')
    expect(readableOn('#0f172a')).toBe('#ffffff')
    expect(luminance('#000000')).toBeLessThan(luminance('#ffffff'))
  })

  it('mixes colors', () => {
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixColors('#336699', '#336699', 0.7)).toBe('#336699')
  })
})

describe('templates + brand', () => {
  it('every template builds valid documents in every format', () => {
    const ids = BANNER_FORMATS.map((f) => f.id)
    for (const template of BANNER_TEMPLATES) {
      const doc = build(template.id, ids, 'https://cdn.example.com/photo.jpg')
      expect(BannerDocumentSchema.safeParse(doc).success).toBe(true)
      expect(doc.formats).toHaveLength(ids.length)
      for (const format of doc.formats) {
        expect(inside(format)).toBe(true)
        const copy = readCopy(format)
        expect(copy.headline).toBe(COPY.headline)
        expect(copy.cta).toBe(COPY.cta)
      }
    }
  })

  it('applies the brand logo and color', () => {
    const doc = build('clean-light', ['gdn-300x250'])
    const format = doc.formats[0]
    const logo = format?.elements.find((e) => e.type === 'logo')
    expect(logo && 'src' in logo ? logo.src : '').toBe(BRAND.logoUrl)
    const cta = format?.elements.find((e) => e.role === 'cta')
    expect(cta?.type === 'button' ? cta.background : null).toEqual({
      kind: 'color',
      color: BRAND.primaryColor,
    })
  })

  it('uses the photo as the background in the photo template', () => {
    const doc = build('photo-overlay', ['meta-1080x1080'], 'https://x/p.jpg')
    expect(doc.formats[0]?.background.kind).toBe('image')
    expect(doc.formats[0]?.elements.some((e) => e.role === 'image')).toBe(false)
  })

  it('places the image when the template has none as background', () => {
    const doc = build('bold-gradient', ['meta-1080x1080'], 'https://x/p.jpg')
    expect(doc.formats[0]?.elements.some((e) => e.role === 'image')).toBe(true)
  })

  it('orders templates by objective first', () => {
    const [first] = templatesForObjective('PROMOTION')
    expect(first?.objectives).toContain('PROMOTION')
    expect(templatesForObjective(null)).toHaveLength(BANNER_TEMPLATES.length)
  })

  it('keeps strips legible: single row, text left of the button', () => {
    const doc = build('bold-gradient', ['gdn-728x90'])
    const format = doc.formats[0]
    const headline = format?.elements.find((e) => e.role === 'headline')
    const cta = format?.elements.find((e) => e.role === 'cta')
    expect(headline && cta && headline.x + headline.w <= cta.x).toBe(true)
    // The subtitle does not fit a 90 px strip.
    expect(format?.elements.some((e) => e.role === 'subheadline')).toBe(false)
  })
})

describe('reflow', () => {
  it('scales proportionally inside the same family', () => {
    const source = build('clean-light', ['gdn-300x250'])
      .formats[0] as BannerFormat
    const target = findBannerFormat('gdn-336x280')
    if (!target) throw new Error('target')
    const out = reflowProportional(source, target)
    expect(out.width).toBe(336)
    expect(out.height).toBe(280)
    const a = source.elements.find((e) => e.role === 'headline')
    const b = out.elements.find((e) => e.role === 'headline')
    expect(b && a ? b.x / a.x : 0).toBeCloseTo(336 / 300, 1)
    expect(out.elements).toHaveLength(source.elements.length)
  })

  it('lays out again across families and keeps the style and copy', () => {
    const source = build('promo-pop', ['meta-1080x1080'], 'https://x/p.jpg')
      .formats[0] as BannerFormat
    const target = findBannerFormat('gdn-728x90')
    if (!target) throw new Error('target')
    const out = reflowFormat(source, target)
    expect(out.formatId).toBe('gdn-728x90')
    expect(inside(out)).toBe(true)
    expect(readCopy(out).headline).toBe(COPY.headline)
    expect(inferStyle(out).uppercase).toBe(true)
    expect(inferStyle(out).fontFamily).toBe('display')
    expect(inferContent(out).imageUrl).toBe('https://x/p.jpg')
  })

  it('keeps hand-added extras (scaled) across families', () => {
    const source = build('clean-light', ['meta-1080x1080'])
      .formats[0] as BannerFormat
    const extra = {
      ...(source.elements.find(
        (e) => e.role === 'headline',
      ) as BannerFormat['elements'][number]),
      id: 'extra1',
      role: 'decor' as const,
    }
    const withExtra: BannerFormat = {
      ...source,
      elements: [...source.elements, extra],
    }
    const target = findBannerFormat('gdn-728x90')
    if (!target) throw new Error('target')
    const out = reflowFormat(withExtra, target)
    expect(out.elements.some((e) => e.id === 'extra1')).toBe(true)
  })

  it('adds missing formats and replaces existing ones on demand', () => {
    const doc = build('clean-light', ['meta-1080x1080', 'gdn-300x250'])
    const targets = ['gdn-300x250', 'gdn-160x600']
      .map((id) => findBannerFormat(id))
      .filter((s) => s !== undefined)
    const out = reflowDocument(doc, 'meta-1080x1080', targets)
    expect(out.formats.map((f) => f.formatId).sort()).toEqual(
      ['gdn-160x600', 'gdn-300x250', 'meta-1080x1080'].sort(),
    )
    const source = doc.formats[0]
    expect(out.formats.find((f) => f.formatId === 'meta-1080x1080')).toBe(
      source,
    )
  })
})

describe('copy by role', () => {
  it('rewrites the text in every format', () => {
    const doc = build('bold-gradient', ['meta-1080x1080', 'gdn-300x250'])
    const next = applyCopy(doc, { headline: 'Novo título', cta: 'Ir agora' })
    for (const format of next.formats) {
      expect(readCopy(format).headline).toBe('Novo título')
      expect(readCopy(format).cta).toBe('Ir agora')
      expect(readCopy(format).subheadline).toBe(COPY.subheadline)
    }
  })
})
