import { describe, expect, it } from 'vitest'
import {
  createFakeSitePage,
  createFakeSnapshot,
  createSiteDocument,
} from '@/src/__tests__/factories/site.factory'
import { diffSiteSnapshots, stableStringify } from '@/src/lib/sites/changes'
import { buildSiteSnapshot, type SiteSnapshot } from '@/src/lib/sites/snapshot'

function snapshot(
  pages: Array<Parameters<typeof createFakeSitePage>[0]>,
  extra: Partial<SiteSnapshot> = {},
): SiteSnapshot {
  return {
    ...buildSiteSnapshot({
      name: 'Clínica',
      theme: {},
      settings: {},
      homePageId: 'home',
      pages: pages.map((page) => createFakeSitePage(page)),
      globals: [],
    }),
    ...extra,
  }
}

const HOME = {
  id: 'home',
  title: 'Início',
  isHome: true,
  document: createSiteDocument('Olá') as never,
}

describe('stableStringify', () => {
  it('ignores key order and undefined values', () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: undefined }] })).toBe(
      stableStringify({ a: [{ d: 2 }], b: 1 }),
    )
    expect(stableStringify(undefined)).toBe('null')
    expect(stableStringify('x')).toBe('"x"')
  })
})

describe('diffSiteSnapshots', () => {
  it('lists everything as new on the first publish', () => {
    const draft = createFakeSnapshot({
      globals: [
        {
          id: 'g1',
          kind: 'HEADER',
          name: 'Topo',
          document: createSiteDocument(),
        },
        {
          id: 'g2',
          kind: 'SYMBOL',
          name: 'Selo',
          document: createSiteDocument(),
        },
      ],
    })
    const changes = diffSiteSnapshots(null, draft)
    expect(changes.firstPublish).toBe(true)
    expect(changes.pages).toEqual([
      { id: 'home', name: 'Início', change: 'added' },
    ])
    expect(changes.globals.map((item) => item.name)).toEqual([
      'Cabeçalho',
      'Selo',
    ])
    expect(changes.total).toBe(3)
  })

  it('reports nothing when the draft equals the live site', () => {
    const live = snapshot([HOME])
    const changes = diffSiteSnapshots(live, structuredClone(live), '2026-10-01')
    expect(changes).toMatchObject({
      firstPublish: false,
      publishedAt: '2026-10-01',
      total: 0,
      structure: false,
      theme: false,
      settings: false,
    })
  })

  it('finds added, changed and removed pages and globals', () => {
    const live = snapshot([HOME, { id: 'old', title: 'Antiga', position: 1 }], {
      globals: [
        {
          id: 'f',
          kind: 'FOOTER',
          name: 'Rodapé',
          document: createSiteDocument('a'),
        },
      ],
    })
    const draft = snapshot(
      [
        { ...HOME, document: createSiteDocument('Novo') as never },
        { id: 'new', title: 'Contato', position: 1 },
      ],
      {
        globals: [
          {
            id: 'f',
            kind: 'FOOTER',
            name: 'Rodapé',
            document: createSiteDocument('b'),
          },
        ],
      },
    )
    const changes = diffSiteSnapshots(live, draft)
    expect(changes.pages).toEqual([
      { id: 'home', name: 'Início', change: 'changed' },
      { id: 'new', name: 'Contato', change: 'added' },
      { id: 'old', name: 'Antiga', change: 'removed' },
    ])
    expect(changes.globals).toEqual([
      { id: 'f', name: 'Rodapé', change: 'changed' },
    ])
    // A different page list is already explained by the items.
    expect(changes.structure).toBe(false)
    expect(changes.total).toBe(4)
  })

  it('flags order, theme and settings changes', () => {
    const pages = [HOME, { id: 'a', title: 'A', position: 1 }]
    const live = snapshot(pages)
    const draft = snapshot(
      [
        { ...pages[1], position: 0 },
        { ...pages[0], position: 1 },
      ],
      {
        theme: { colors: { primary: '#000000' } },
        name: 'Outro nome',
      },
    )
    const changes = diffSiteSnapshots(live, draft)
    expect(changes.pages).toEqual([])
    expect(changes).toMatchObject({
      structure: true,
      theme: true,
      settings: true,
      total: 3,
    })
  })
})
