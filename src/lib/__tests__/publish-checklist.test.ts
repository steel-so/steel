import { describe, expect, it } from 'vitest'
import {
  isBlank,
  isBlankLink,
  summarizePublishChecks,
  visiblePublishNodes,
} from '@/src/lib/canvas/checklist'
import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import { documentChecklist } from '@/src/lib/canvas-document/checklist'
import { siteChecklist, sitePageChecks } from '@/src/lib/canvas-site/checklist'
import { siteSnapshotChecks } from '@/src/lib/sites/checks'
import type { SiteSnapshot } from '@/src/lib/sites/snapshot'

function doc(
  catalog: string,
  nodes: Array<{
    id: string
    type: string
    props?: Record<string, unknown>
    meta?: CanvasNode['meta']
    children?: string[]
  }>,
): CanvasDocument {
  const root = nodes[0]
  return {
    catalog,
    version: 1,
    rootId: root.id,
    nodes: Object.fromEntries(
      nodes.map((node) => [node.id, { props: {}, ...node }]),
    ),
  }
}

const site = (...children: Array<Omit<Parameters<typeof doc>[1][number], 'id'>>) =>
  doc('site', [
    { id: 'root', type: 'site.page', children: children.map((_, i) => `n${i}`) },
    ...children.map((child, i) => ({ ...child, id: `n${i}` })),
  ])

describe('generic helpers', () => {
  it('detects blank text and links', () => {
    expect(isBlank(undefined)).toBe(true)
    expect(isBlank('  ')).toBe(true)
    expect(isBlank('x')).toBe(false)
    expect(isBlankLink(undefined)).toBe(true)
    expect(isBlankLink({ type: 'url', value: ' ' })).toBe(true)
    expect(isBlankLink({ type: 'url', value: 'https://a.b' })).toBe(false)
  })

  it('summarizes errors and warnings', () => {
    const summary = summarizePublishChecks([
      { code: 'A', level: 'warning', message: 'a' },
      { code: 'B', level: 'error', message: 'b' },
    ])
    expect(summary.blocking).toBe(true)
    expect(summary.errors).toHaveLength(1)
    expect(summary.warnings).toHaveLength(1)
    expect(summarizePublishChecks([]).blocking).toBe(false)
  })

  it('skips hidden subtrees, cycles and malformed documents', () => {
    const tree = doc('site', [
      { id: 'root', type: 'r', children: ['a', 'b', 'a'] },
      { id: 'a', type: 'x', meta: { hidden: true }, children: ['c'] },
      { id: 'b', type: 'y', children: ['root'] },
      { id: 'c', type: 'z' },
    ])
    expect(visiblePublishNodes(tree).map((node) => node.id)).toEqual([
      'root',
      'b',
    ])
    expect(
      visiblePublishNodes({ catalog: 'site' } as unknown as CanvasDocument),
    ).toEqual([])
  })
})

describe('siteChecklist', () => {
  it('is clean for a healthy page', () => {
    expect(
      siteChecklist(
        site(
          {
            type: 'site.image',
            props: { image: { src: 'https://a/b.png', alt: 'Fachada' } },
          },
          {
            type: 'site.button',
            props: { link: { type: 'url', value: 'https://a.b' } },
          },
          { type: 'site.form', props: { formToken: 'abc' } },
          { type: 'site.image', props: { image: { src: '', alt: '' } } },
        ),
      ),
    ).toEqual([])
  })

  it('flags images without alt (single, gallery and logos)', () => {
    const items = siteChecklist(
      site(
        {
          type: 'site.image',
          props: { image: { src: 'https://a/b.png', alt: ' ' } },
        },
        {
          type: 'site.gallery',
          props: {
            items: [
              { image: { src: 'https://a/1.png', alt: '' } },
              { image: { src: 'https://a/2.png', alt: '' } },
              { image: { src: 'https://a/3.png', alt: 'ok' } },
            ],
          },
        },
        {
          type: 'site.logos',
          props: { items: [{ image: { src: 'https://a/1.png', alt: '' } }] },
        },
        { type: 'site.logos', props: {} },
      ),
    )
    expect(items.map((item) => [item.code, item.level, item.message])).toEqual([
      ['IMAGE_ALT_MISSING', 'warning', 'Imagem sem texto alternativo'],
      ['IMAGE_ALT_MISSING', 'warning', '2 imagens sem texto alternativo'],
      ['IMAGE_ALT_MISSING', 'warning', 'Imagem sem texto alternativo'],
    ])
  })

  it('flags buttons that do nothing, but accepts interactions', () => {
    const items = siteChecklist(
      site(
        { type: 'site.button', props: { link: { type: 'url', value: '' } } },
        { type: 'site.button', props: {} },
        {
          type: 'site.button',
          props: {
            link: { type: 'url', value: '' },
            interaction: { action: 'popup', target: 'oferta' },
          },
        },
        {
          type: 'site.button',
          props: {
            link: { type: 'url', value: '' },
            interaction: {
              action: 'link',
              link: { type: 'url', value: 'https://a.b' },
            },
          },
        },
        {
          type: 'site.button',
          props: {
            link: { type: 'url', value: '' },
            interaction: { action: 'link', link: { type: 'url', value: '' } },
          },
        },
        {
          type: 'site.button',
          props: { link: { type: 'url', value: '' }, interaction: { action: 'none' } },
        },
      ),
    )
    expect(items.map((item) => item.code)).toEqual([
      'BUTTON_NO_LINK',
      'BUTTON_NO_LINK',
      'BUTTON_NO_LINK',
      'BUTTON_NO_LINK',
    ])
  })

  it('blocks forms without a destination and flags started empty links', () => {
    const items = siteChecklist(
      site(
        { type: 'site.form', props: { formToken: '' } },
        {
          type: 'site.heading',
          props: { link: { type: 'page', value: '' } },
        },
        {
          type: 'site.heading',
          props: { link: { type: 'page', value: 'p1' } },
        },
        { type: 'site.heading', props: {} },
        { type: 'site.text', meta: { hidden: true }, props: { link: { value: '' } } },
      ),
    )
    expect(items.map((item) => [item.code, item.level])).toEqual([
      ['FORM_NO_DESTINATION', 'error'],
      ['LINK_EMPTY', 'warning'],
    ])
    expect(items[0].nodeId).toBe('n0')
  })

  it('warns about pages without an SEO title', () => {
    expect(sitePageChecks({ id: 'p', title: 'Sobre', seo: {} })).toEqual([
      expect.objectContaining({
        code: 'PAGE_SEO_TITLE_MISSING',
        level: 'warning',
        documentId: 'p',
        documentName: 'Sobre',
      }),
    ])
    expect(sitePageChecks({ id: 'p', title: 'Sobre', seo: { title: ' ' } })).toHaveLength(1)
    expect(sitePageChecks({ id: 'p', title: 'Sobre' })).toHaveLength(1)
    expect(
      sitePageChecks({ id: 'p', title: 'Sobre', seo: { title: 'Sobre nós' } }),
    ).toEqual([])
  })
})

describe('siteSnapshotChecks', () => {
  it('collects pages and globals with the document they belong to', () => {
    const bad = site({ type: 'site.form', props: { formToken: '' } })
    const snapshot = {
      pages: [
        { id: 'p1', title: 'Início', seo: { title: 'Início' }, document: bad },
        { id: 'p2', title: 'Sobre', seo: {}, document: site() },
      ],
      globals: [
        { id: 'g1', kind: 'FOOTER', name: 'x', document: bad },
        { id: 'g2', kind: 'SYMBOL', name: 'Selo', document: bad },
      ],
    } as unknown as SiteSnapshot
    const items = siteSnapshotChecks(snapshot)
    expect(items.map((item) => [item.code, item.documentId, item.documentName])).toEqual([
      ['FORM_NO_DESTINATION', 'p1', 'Início'],
      ['PAGE_SEO_TITLE_MISSING', 'p2', 'Sobre'],
      ['FORM_NO_DESTINATION', 'g1', 'Rodapé'],
      ['FORM_NO_DESTINATION', 'g2', 'Selo'],
    ])
  })
})

describe('documentChecklist', () => {
  const content = (...children: Array<{ type: string; props?: Record<string, unknown> }>) =>
    doc('document', [
      { id: 'root', type: 'document', children: ['s'] },
      { id: 's', type: 'section', children: children.map((_, i) => `n${i}`) },
      ...children.map((child, i) => ({ ...child, id: `n${i}` })),
    ])

  it('is clean for a healthy document', () => {
    expect(
      documentChecklist(
        content(
          { type: 'heading', props: { text: 'Proposta' } },
          { type: 'text', props: { html: '<p>Olá</p>' } },
          { type: 'image', props: { src: 'https://a/b.png', alt: 'Logo' } },
          { type: 'image', props: {} },
          { type: 'button', props: { label: 'Ver', link: { type: 'url', value: 'https://a.b' } } },
          { type: 'video', props: { url: 'https://youtu.be/x' } },
          { type: 'pricing-table', props: { items: [{ id: 'i' }] } },
          { type: 'field-text', props: { label: 'Nome' } },
        ),
      ),
    ).toEqual([])
  })

  it('warns about alt text, links and empty blocks', () => {
    const items = documentChecklist(
      content(
        { type: 'image', props: { src: 'https://a/b.png', alt: '' } },
        {
          type: 'gallery',
          props: { images: [{ src: 'https://a/1.png' }, { src: 'https://a/2.png', alt: '' }] },
        },
        { type: 'gallery', props: { images: [{ src: 'https://a/1.png' }] } },
        { type: 'logos', props: { items: [{ src: 'https://a/1.png', alt: 'ok' }] } },
        { type: 'gallery', props: {} },
        { type: 'button', props: { label: 'Ver' } },
        { type: 'heading', props: { text: ' ' } },
        { type: 'text', props: { html: '<p></p>' } },
        { type: 'text', props: {} },
        { type: 'video', props: { url: '' } },
      ),
    )
    expect(items.map((item) => [item.code, item.level])).toEqual([
      ['IMAGE_ALT_MISSING', 'warning'],
      ['IMAGE_ALT_MISSING', 'warning'],
      ['IMAGE_ALT_MISSING', 'warning'],
      ['LINK_EMPTY', 'warning'],
      ['HEADING_EMPTY', 'warning'],
      ['TEXT_EMPTY', 'warning'],
      ['TEXT_EMPTY', 'warning'],
      ['VIDEO_URL_EMPTY', 'warning'],
    ])
    expect(items[1].message).toBe('2 imagens sem texto alternativo')
  })

  it('blocks empty pricing tables and untitled fields', () => {
    const items = documentChecklist(
      content(
        { type: 'pricing-table', props: { items: [] } },
        { type: 'pricing-table', props: {} },
        { type: 'field-email', props: { label: '' } },
        { type: 'field-select', props: {} },
      ),
    )
    expect(items.map((item) => [item.code, item.level])).toEqual([
      ['PRICING_EMPTY', 'error'],
      ['PRICING_EMPTY', 'error'],
      ['FIELD_LABEL_EMPTY', 'error'],
      ['FIELD_LABEL_EMPTY', 'error'],
    ])
  })
})
