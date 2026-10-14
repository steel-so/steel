import { describe, expect, it } from 'vitest'
import { createFakeWikiPage } from '@/src/__tests__/factories/wiki-page.factory'
import { toWikiPageDTO, toWikiPublicPageDTO } from '../wiki-page.mapper'

const VIEWER = { canManageLock: false, isFavorite: false }

describe('toWikiPageDTO()', () => {
  it('should map a WikiPage to its DTO', () => {
    const wikiPage = createFakeWikiPage({
      id: 'w1',
      title: 'Onboarding',
      archivedAt: null,
    })

    const dto = toWikiPageDTO(wikiPage, VIEWER)

    expect(dto.id).toBe('w1')
    expect(dto.title).toBe('Onboarding')
    expect(dto.archivedAt).toBeNull()
    expect(dto.publishedAt).toBeNull()
    expect(dto.publicToken).toBeNull()
    expect(dto.lockedAt).toBeNull()
    expect(dto.lockedById).toBeNull()
    expect(dto.createdBy).toBeNull()
    expect(dto.updatedBy).toBeNull()
    expect(typeof dto.createdAt).toBe('string')
  })

  it('should format archivedAt as ISO string when present', () => {
    const archivedAt = new Date('2026-01-01T00:00:00.000Z')
    const wikiPage = createFakeWikiPage({ archivedAt })

    const dto = toWikiPageDTO(wikiPage, VIEWER)

    expect(dto.archivedAt).toBe(archivedAt.toISOString())
  })

  it('should map publication, lock, people and the viewer fields', () => {
    const publishedAt = new Date('2026-10-01T12:00:00.000Z')
    const lockedAt = new Date('2026-10-02T12:00:00.000Z')
    const wikiPage = createFakeWikiPage({
      publicToken: 'tok',
      publishedAt,
      lockedAt,
      lockedById: 'u1',
      createdBy: { id: 'u1', name: 'Ana', image: null },
      updatedBy: { id: 'u2', name: 'Bia', image: 'https://img/b.png' },
    })

    const dto = toWikiPageDTO(wikiPage, {
      canManageLock: true,
      isFavorite: true,
    })

    expect(dto).toMatchObject({
      publicToken: 'tok',
      publishedAt: publishedAt.toISOString(),
      lockedAt: lockedAt.toISOString(),
      lockedById: 'u1',
      canManageLock: true,
      isFavorite: true,
      createdBy: { id: 'u1', name: 'Ana', image: null },
      updatedBy: { id: 'u2', name: 'Bia', image: 'https://img/b.png' },
    })
  })
})

describe('toWikiPublicPageDTO()', () => {
  it('should expose only the public fields, with the given media', () => {
    const publishedAt = new Date('2026-10-01T12:00:00.000Z')
    const wikiPage = createFakeWikiPage({
      title: 'Manual',
      icon: '📘',
      publishedAt,
      publicToken: 'tok',
    })
    const content = [{ type: 'p', children: [{ text: 'oi' }] }]

    const dto = toWikiPublicPageDTO(wikiPage, {
      content,
      coverImage: '/cover',
    })

    expect(dto).toEqual({
      title: 'Manual',
      icon: '📘',
      coverImage: '/cover',
      content,
      publishedAt: publishedAt.toISOString(),
      updatedAt: wikiPage.updatedAt.toISOString(),
    })
  })

  it('should fall back to updatedAt when publishedAt is missing', () => {
    const wikiPage = createFakeWikiPage({ publishedAt: null })

    const dto = toWikiPublicPageDTO(wikiPage, { content: [], coverImage: null })

    expect(dto.publishedAt).toBe(wikiPage.updatedAt.toISOString())
  })
})
