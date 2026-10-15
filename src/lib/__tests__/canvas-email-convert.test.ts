import { describe, expect, it } from 'vitest'
import { validateDocument } from '@/src/lib/canvas/ops'
import { emailCatalog } from '@/src/lib/canvas-email/catalog'
import {
  convertSection,
  convertV1Document,
  createEmailDocumentFromLayout,
  isEmailCanvasDocument,
  openEmailDocument,
} from '@/src/lib/canvas-email/convert-v1'
import {
  EMAIL_PRESET_CATEGORIES,
  EMAIL_PRESETS,
  EMAIL_STARTERS,
} from '@/src/lib/canvas-email/presets'
import { renderEmailDocument } from '@/src/lib/canvas-email/render'
import {
  createBuilderDocument,
  EMAIL_LAYOUTS,
} from '@/src/lib/crm-email-builder/layouts'
import { renderBuilderEmail } from '@/src/lib/crm-email-builder/render'
import {
  EMAIL_BUILDER_LAYOUT_IDS,
  type EmailBuilderDocument,
} from '@/src/schemas/crm-email-builder.schema'

const brand = {
  companyName: 'Acme',
  logoUrl: 'https://cdn.acme.example/logo.png',
  primaryColor: '#2893CC',
  address: 'Rua A, 1',
  website: 'https://acme.example',
}

/** Words of the plain-text version, in order. */
function words(text: string): string[] {
  return text
    .replace(/[“”"→▶]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

const attr = (html: string, name: string) =>
  [...html.matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))]
    .map((m) => m[1].replace(/&amp;/g, '&'))
    .filter((value) => !value.startsWith('https://fonts.'))

/** A v1 document with every optional section shown and images filled. */
function richV1(layout: (typeof EMAIL_BUILDER_LAYOUT_IDS)[number]) {
  const doc = createBuilderDocument(layout)
  for (const section of doc.sections) {
    section.hidden = false
    if (section.type === 'hero' || section.type === 'image') {
      section.props.imageSrc = 'https://x.example/hero.png'
      section.props.imageAlt = 'Destaque'
    }
    if (section.type === 'image') {
      section.props.caption = 'Legenda'
      section.props.linkUrl = 'https://x.example'
    }
    if (section.type === 'button') section.props.note = 'Observação'
  }
  return doc
}

describe('v1 → v2 converter', () => {
  it.each(EMAIL_BUILDER_LAYOUT_IDS)(
    '%s converts to a valid v2 document',
    (layout) => {
      const doc = createEmailDocumentFromLayout(layout)
      expect(doc.catalog).toBe('email')
      expect(doc.version).toBe(2)
      const result = validateDocument(doc, emailCatalog)
      expect(result.ok).toBe(true)
      const root = doc.nodes[doc.rootId]
      expect(doc.nodes[root.children?.at(-1) as string].type).toBe(
        'email.footer',
      )
      expect(root.props.preheader).toBe(EMAIL_LAYOUTS[layout].previewText)
    },
  )

  it.each(EMAIL_BUILDER_LAYOUT_IDS)(
    '%s renders equivalent to v1 (same text, links and images in order)',
    async (layout) => {
      const v1 = richV1(layout)
      const v2 = convertV1Document(v1)
      expect(validateDocument(v2, emailCatalog).ok).toBe(true)
      const before = await renderBuilderEmail(v1, brand, { subject: 'Oi' })
      const after = await renderEmailDocument(v2, { brand, subject: 'Oi' })
      expect(words(after.text)).toEqual(words(before.text))
      expect(attr(after.html, 'href')).toEqual(attr(before.html, 'href'))
      expect(attr(after.html, 'src')).toEqual(attr(before.html, 'src'))
    },
  )

  it('is deterministic and keeps hidden sections hidden', () => {
    const v1 = createBuilderDocument('newsletter')
    expect(convertV1Document(v1)).toEqual(convertV1Document(v1))
    const hidden = v1.sections.find((s) => s.hidden)
    expect(hidden).toBeDefined()
    const doc = convertV1Document(v1)
    expect(doc.nodes[`${hidden?.id}-s`].meta).toEqual({ hidden: true })
  })

  it('adds the footer when a v1 document lacks one', () => {
    const v1: EmailBuilderDocument = {
      version: 1,
      layout: 'newsletter',
      previewText: '',
      sections: [{ id: 'header', type: 'header', hidden: false, props: {} }],
    }
    const doc = convertV1Document(v1)
    expect(doc.nodes.footer.props.note).toBe('')
    expect(validateDocument(doc, emailCatalog).ok).toBe(true)
  })

  it('converts edge cases: empty labels, empty headings, links', () => {
    const fragment = convertSection({
      id: 'b',
      type: 'button',
      hidden: false,
      props: { label: '', url: '', note: '' },
    })
    const button = Object.values(fragment.nodes).find(
      (n) => n.type === 'email.button',
    )
    expect(button?.props.label).toBe('')
    const text = convertSection({
      id: 't',
      type: 'text',
      hidden: false,
      props: { heading: '', body: '<p>x</p>' },
    })
    expect(
      Object.values(text.nodes).some((n) => n.type === 'email.heading'),
    ).toBe(false)
    const image = convertSection({
      id: 'i',
      type: 'image',
      hidden: false,
      props: { imageSrc: '', imageAlt: '', linkUrl: '', caption: '<b>' },
    })
    const img = Object.values(image.nodes).find((n) => n.type === 'email.image')
    expect(img?.props.link).toBeUndefined()
    const caption = Object.values(image.nodes).find(
      (n) => n.type === 'email.text',
    )
    expect(caption?.props.html).toBe('<p>&lt;b&gt;</p>')
    const footer = convertSection({
      id: 'f',
      type: 'footer',
      hidden: false,
      props: { note: '' },
    })
    expect(footer.nodes['f-c'].children).toEqual([])
  })

  it('opens stored documents: v2 as is, v1 converted, junk as null', () => {
    const v2 = createEmailDocumentFromLayout('lembrete')
    expect(openEmailDocument(v2)).toBe(v2)
    expect(isEmailCanvasDocument(v2)).toBe(true)
    const opened = openEmailDocument(createBuilderDocument('lembrete'))
    expect(opened).toEqual(v2)
    expect(openEmailDocument(null)).toBeNull()
    expect(openEmailDocument({ version: 1 })).toBeNull()
    expect(isEmailCanvasDocument({ catalog: 'email', version: 1 })).toBe(false)
    expect(isEmailCanvasDocument('x')).toBe(false)
  })
})

describe('presets ("Seções prontas") and starters', () => {
  it('offers column layouts and one preset per v1 section type', () => {
    const ids = EMAIL_PRESETS.map((p) => p.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'columns-1',
        'columns-2',
        'columns-3',
        'columns-4',
        'section-header',
        'section-hero',
        'section-products',
        'section-coupon',
        'section-event',
        'section-nps',
        'section-quote',
        'section-signature',
        'section-features',
        'section-text',
        'section-image',
        'section-button',
      ]),
    )
    expect(new Set(ids).size).toBe(ids.length)
    for (const preset of EMAIL_PRESETS) {
      expect(EMAIL_PRESET_CATEGORIES).toContain(preset.category)
    }
  })

  it('returns fresh ids on every call, insertable in a document', () => {
    for (const preset of EMAIL_PRESETS) {
      const a = preset.fragment()
      const b = preset.fragment()
      expect(a.rootId).not.toBe(b.rootId)
      const root = a.nodes[a.rootId]
      expect(root.type).toBe('email.section')
      expect(root.meta?.hidden).toBeUndefined()
    }
    const two = EMAIL_PRESETS.find((p) => p.id === 'columns-2')?.fragment()
    expect(two?.nodes[two.rootId].children).toHaveLength(2)
  })

  it('has one starter per gallery layout', () => {
    expect(EMAIL_STARTERS.map((s) => s.id)).toEqual([
      ...EMAIL_BUILDER_LAYOUT_IDS,
    ])
    const doc = EMAIL_STARTERS[0].document()
    expect(validateDocument(doc, emailCatalog).ok).toBe(true)
    expect(EMAIL_STARTERS[0].defaultSubject).toContain('{{')
  })
})
