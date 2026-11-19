import { describe, expect, it } from 'vitest'
import {
  BANNER_TEMPLATES,
  buildBannerDocument,
} from '@/src/lib/banners/templates'
import { toCrmBannerDTO, toCrmBannerListItemDTO } from '../crm-banner.mapper'

const template = BANNER_TEMPLATES[0]
if (!template) throw new Error('no template')
const document = buildBannerDocument({
  template,
  brand: { companyName: '', logoUrl: '', primaryColor: '#2563eb' },
  formatIds: ['gdn-300x250', 'gdn-728x90'],
})

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    workspaceId: 'ws1',
    name: 'Verão',
    folder: 'Sazonal',
    tags: ['display'],
    objective: 'SALES',
    document,
    createdById: 'u1',
    updatedById: null,
    createdAt: new Date('2026-11-19T10:00:00Z'),
    updatedAt: new Date('2026-11-19T11:00:00Z'),
    deletedAt: null,
    ...overrides,
  } as never
}

describe('toCrmBannerDTO()', () => {
  it('maps the fields and serializes dates', () => {
    const dto = toCrmBannerDTO(row())
    expect(dto).toMatchObject({
      id: 'b1',
      name: 'Verão',
      folder: 'Sazonal',
      tags: ['display'],
      objective: 'SALES',
      createdAt: '2026-11-19T10:00:00.000Z',
      updatedAt: '2026-11-19T11:00:00.000Z',
    })
    expect(dto.document.formats).toHaveLength(2)
  })

  it('drops an unknown objective', () => {
    expect(toCrmBannerDTO(row({ objective: 'OTHER' })).objective).toBeNull()
  })

  it('falls back to an empty document when the stored JSON is invalid', () => {
    const dto = toCrmBannerDTO(row({ document: { foo: 'bar' } }))
    expect(dto.document.formats).toHaveLength(1)
    expect(dto.document.formats[0]?.elements).toEqual([])
  })
})

describe('toCrmBannerListItemDTO()', () => {
  it('keeps only the cover format and reports the rest', () => {
    const dto = toCrmBannerListItemDTO(row())
    expect(dto.document.formats).toHaveLength(1)
    expect(dto.document.formats[0]?.formatId).toBe('gdn-300x250')
    expect(dto.formatCount).toBe(2)
    expect(dto.formatIds).toEqual(['gdn-300x250', 'gdn-728x90'])
  })
})
