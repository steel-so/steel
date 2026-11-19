import { describe, expect, it } from 'vitest'
import {
  duplicateElement,
  moveElementOrder,
  removeElement,
  replaceFormat,
  updateElement,
} from '@/src/lib/banners/document'
import { createElementFor } from '@/src/lib/banners/elements'
import {
  BANNER_TEMPLATES,
  buildBannerDocument,
} from '@/src/lib/banners/templates'
import {
  BannerElementSchema,
  type BannerFormat,
} from '@/src/schemas/crm-banner.schema'

const template = BANNER_TEMPLATES[1]
if (!template) throw new Error('no template')
const doc = buildBannerDocument({
  template,
  brand: { companyName: '', logoUrl: '', primaryColor: '#2563eb' },
  formatIds: ['gdn-300x250'],
})
const format = doc.formats[0] as BannerFormat

describe('document operations', () => {
  it('updates one element without touching the others', () => {
    const target = format.elements[1]
    if (!target) throw new Error('element')
    const next = updateElement(format, target.id, { x: 99 })
    expect(next.elements[1]?.x).toBe(99)
    expect(next.elements[0]).toBe(format.elements[0])
    expect(format.elements[1]?.x).not.toBe(99)
  })

  it('removes, reorders and duplicates', () => {
    const [first, second] = format.elements
    if (!first || !second) throw new Error('elements')
    expect(removeElement(format, first.id).elements).toHaveLength(
      format.elements.length - 1,
    )
    const moved = moveElementOrder(format, first.id, 1)
    expect(moved.elements[1]?.id).toBe(first.id)
    expect(moveElementOrder(format, first.id, -1)).toBe(format)

    const copy = duplicateElement(format, second.id)
    expect(copy.id).not.toBeNull()
    expect(copy.id).not.toBe(second.id)
    expect(copy.format.elements).toHaveLength(format.elements.length + 1)
    expect(duplicateElement(format, 'missing').id).toBeNull()
  })

  it('replaces a format by id', () => {
    const changed = { ...format, width: 301 }
    expect(replaceFormat(doc, changed).formats[0]?.width).toBe(301)
  })
})

describe('createElementFor()', () => {
  it('creates valid elements of every kind, centered in the format', () => {
    for (const kind of ['text', 'button', 'image', 'logo', 'shape'] as const) {
      const element = createElementFor(format, kind, { brandColor: '#112233' })
      expect(BannerElementSchema.safeParse(element).success).toBe(true)
      expect(element.x + element.w / 2).toBeCloseTo(format.width / 2, 0)
      expect(element.y + element.h / 2).toBeCloseTo(format.height / 2, 0)
    }
  })

  it('gives the semantic role only to the first of its kind', () => {
    const empty: BannerFormat = { ...format, elements: [] }
    const first = createElementFor(empty, 'button')
    expect(first.role).toBe('cta')
    const second = createElementFor({ ...empty, elements: [first] }, 'button')
    expect(second.role).toBe('decor')
  })
})
