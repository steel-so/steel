import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const page = (frontmatter: string, body = '## Seção\n\nTexto.') =>
  `---\n${frontmatter}\n---\n\n${body}\n`

const FM = (section: string, order: number, title = `Página ${order}`) =>
  `title: ${title}\ndescription: Descrição longa o bastante da página ${order}.\nsection: ${section}\norder: ${order}`

let root: string

async function loadWith(files: Record<string, string> | null) {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'steel-docs-'))
  if (files) {
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(root, 'content', 'docs', name)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, content)
    }
  }
  vi.spyOn(process, 'cwd').mockReturnValue(root)
  vi.resetModules()
  return import('@/src/lib/docs/pages')
}

describe('docs pages loader', () => {
  beforeEach(() => vi.restoreAllMocks())

  afterEach(async () => {
    vi.restoreAllMocks()
    if (root) await fs.rm(root, { recursive: true, force: true })
  })

  it('sorts by section, overview first, then order and title', async () => {
    const { getAllDocsMeta } = await loadWith({
      'crm/leads.mdx': page(FM('crm', 1)),
      'crm/index.mdx': page(FM('crm', 9, 'CRM')),
      'comecando/b.mdx': page(FM('comecando', 2, 'Beta')),
      'comecando/a.mdx': page(FM('comecando', 2, 'Alfa')),
      'comecando/index.mdx': page(FM('comecando', 5, 'Início')),
      'comecando/notes.txt': 'ignored',
      'README.md': 'ignored file at the root',
    })

    const pages = await getAllDocsMeta()

    expect(pages.map((p) => p.href)).toEqual([
      '/docs/comecando',
      '/docs/comecando/a',
      '/docs/comecando/b',
      '/docs/crm',
      '/docs/crm/leads',
    ])
    expect(pages[1]).toEqual({
      section: 'comecando',
      slug: 'a',
      href: '/docs/comecando/a',
      title: 'Alfa',
      description: 'Descrição longa o bastante da página 2.',
      order: 2,
    })
  })

  it('returns no pages when content/docs does not exist', async () => {
    const { getAllDocs, getDocsNav } = await loadWith(null)
    await expect(getAllDocs()).resolves.toEqual([])
    await expect(getDocsNav()).resolves.toEqual([])
  })

  it('finds a page by its url segments, with source and headings', async () => {
    const { getDocByPath } = await loadWith({
      'faq/index.mdx': page(FM('faq', 0), '## Uma\n\n### Duas'),
    })

    const found = await getDocByPath(['faq'])

    expect(found?.source).toBe('## Uma\n\n### Duas')
    expect(found?.headings).toEqual([
      { level: 2, id: 'uma', text: 'Uma' },
      { level: 3, id: 'duas', text: 'Duas' },
    ])
    await expect(getDocByPath(['faq', 'nada'])).resolves.toBeNull()
  })

  it('builds the sidebar with only the sections that have pages', async () => {
    const { getDocsNav } = await loadWith({
      'crm/index.mdx': page(FM('crm', 0, 'CRM')),
      'crm/leads.mdx': page(FM('crm', 1, 'Leads')),
    })

    const nav = await getDocsNav()

    expect(nav).toHaveLength(1)
    expect(nav[0]).toMatchObject({
      slug: 'crm',
      label: 'CRM',
      pages: [
        { href: '/docs/crm', title: 'CRM' },
        { href: '/docs/crm/leads', title: 'Leads' },
      ],
    })
  })

  it('links each page to its neighbours across sections', async () => {
    const { getAdjacentDocs } = await loadWith({
      'comecando/index.mdx': page(FM('comecando', 0)),
      'crm/index.mdx': page(FM('crm', 0)),
    })

    const first = await getAdjacentDocs('/docs/comecando')
    const last = await getAdjacentDocs('/docs/crm')
    const unknown = await getAdjacentDocs('/docs/nada')

    expect(first.prev).toBeNull()
    expect(first.next?.href).toBe('/docs/crm')
    expect(last.prev?.href).toBe('/docs/comecando')
    expect(last.next).toBeNull()
    expect(unknown).toEqual({ prev: null, next: null })
  })

  it('indexes titles, section labels and headings for the search', async () => {
    const { getDocsSearchIndex } = await loadWith({
      'steel-ai/modos.mdx': page(FM('steel-ai', 1, 'Modos'), '## Autopilot'),
    })

    await expect(getDocsSearchIndex()).resolves.toEqual([
      {
        href: '/docs/steel-ai/modos',
        title: 'Modos',
        description: 'Descrição longa o bastante da página 1.',
        section: 'Steel AI',
        headings: [{ id: 'autopilot', text: 'Autopilot' }],
      },
    ])
  })

  it.each([
    [
      'invalid frontmatter',
      { 'crm/a.mdx': page('title: x\nsection: crm\norder: 1') },
      'Invalid frontmatter in content/docs/crm/a.mdx',
    ],
    [
      'a section that differs from the folder',
      { 'crm/a.mdx': page(FM('faq', 1)) },
      'Section mismatch in content/docs/crm/a.mdx',
    ],
    [
      'an unknown section folder',
      { 'blog/a.mdx': page(FM('crm', 1)) },
      'Unknown docs section folder: content/docs/blog',
    ],
    [
      'a file name that is not a slug',
      { 'crm/Leads Novos.mdx': page(FM('crm', 1)) },
      'Invalid docs file name: content/docs/crm/Leads Novos.mdx',
    ],
  ])('fails loudly on %s', async (_label, files, message) => {
    const { getAllDocs } = await loadWith(files)
    await expect(getAllDocs()).rejects.toThrow(message)
  })

  it('rethrows unexpected read errors', async () => {
    const { getAllDocs } = await loadWith(null)
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' })
    vi.spyOn(fs, 'readdir').mockRejectedValueOnce(denied)
    await expect(getAllDocs()).rejects.toThrow('denied')
  })
})

describe('repository content (content/docs)', () => {
  it('every page parses and every internal link points to a real page and heading', async () => {
    vi.restoreAllMocks()
    vi.resetModules()
    const { getAllDocs } = await import('@/src/lib/docs/pages')
    const pages = await getAllDocs()
    expect(pages.length).toBeGreaterThan(40)

    const byHref = new Map(pages.map((p) => [p.href, p]))
    const broken: string[] = []
    const imageExists = async (target: string) =>
      fs
        .access(path.join(process.cwd(), 'public', target))
        .then(() => true)
        .catch(() => false)
    for (const p of pages) {
      for (const match of p.source.matchAll(/\]\((\/docs[^)\s]*)\)/g)) {
        const [target, anchor] = match[1].split('#')
        // A screenshot is a static file under public/, not a page.
        if (/\.(webp|png|jpe?g|gif|svg|avif)$/i.test(target)) {
          if (!(await imageExists(target))) {
            broken.push(`${p.href} -> ${match[1]} (image file missing)`)
          }
          continue
        }
        const dest = byHref.get(target)
        if (!dest) broken.push(`${p.href} -> ${match[1]}`)
        else if (anchor && !dest.headings.some((h) => h.id === anchor)) {
          broken.push(`${p.href} -> ${match[1]} (missing heading)`)
        }
      }
    }
    expect(broken).toEqual([])
  })

  it('every section has an overview page', async () => {
    vi.resetModules()
    const { getDocsNav } = await import('@/src/lib/docs/pages')
    for (const section of await getDocsNav()) {
      expect(section.pages[0].href).toBe(`/docs/${section.slug}`)
    }
  })
})
