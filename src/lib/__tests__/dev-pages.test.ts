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
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'steel-dev-'))
  if (files) {
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(root, 'content', 'dev', name)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, content)
    }
  }
  vi.spyOn(process, 'cwd').mockReturnValue(root)
  vi.resetModules()
  return import('@/src/lib/dev/pages')
}

describe('dev pages loader', () => {
  beforeEach(() => vi.restoreAllMocks())

  afterEach(async () => {
    vi.restoreAllMocks()
    if (root) await fs.rm(root, { recursive: true, force: true })
  })

  it('sorts by sidebar group, then order and title, across folders', async () => {
    const { getAllDevPagesMeta } = await loadWith({
      'suporte.mdx': page(FM('recursos', 1)),
      'guias/b.mdx': page(FM('guias', 2, 'Beta')),
      'guias/a.mdx': page(FM('guias', 2, 'Alfa')),
      'comecando.mdx': page(FM('introducao', 1, 'Começando')),
      'limites.mdx': page(FM('fundamentos', 3)),
      'guias/notes.txt': 'ignored',
      'README.md': 'ignored file at the root',
      'rascunhos/fundo/c.mdx': page(FM('guias', 1)),
    })

    const pages = await getAllDevPagesMeta()

    expect(pages.map((p) => p.href)).toEqual([
      '/dev/comecando',
      '/dev/limites',
      '/dev/guias/a',
      '/dev/guias/b',
      '/dev/suporte',
    ])
    expect(pages[2]).toEqual({
      section: 'guias',
      slug: 'guias/a',
      href: '/dev/guias/a',
      title: 'Alfa',
      description: 'Descrição longa o bastante da página 2.',
      order: 2,
    })
  })

  it('returns no guides when content/dev does not exist, but keeps the reference', async () => {
    const { getAllDevPages, getDevNav, getDevSearchIndex } =
      await loadWith(null)

    await expect(getAllDevPages()).resolves.toEqual([])
    await expect(getDevNav()).resolves.toEqual([
      {
        slug: 'referencia',
        label: 'Referência',
        pages: [
          { href: '/dev/api', title: 'Referência da API' },
          { href: '/dev/api/v1', title: 'Referência da API v1' },
        ],
      },
    ])
    const index = await getDevSearchIndex()
    expect(index.map((entry) => entry.href)).toEqual([
      '/dev',
      '/dev/api',
      '/dev/api/v1',
    ])
  })

  it('finds a page by its url segments, with source and headings', async () => {
    const { getDevPageByPath } = await loadWith({
      'guias/criar-lead.mdx': page(FM('guias', 1), '## Uma\n\n### Duas'),
    })

    const found = await getDevPageByPath(['guias', 'criar-lead'])

    expect(found?.source).toBe('## Uma\n\n### Duas')
    expect(found?.headings).toEqual([
      { level: 2, id: 'uma', text: 'Uma' },
      { level: 3, id: 'duas', text: 'Duas' },
    ])
    await expect(getDevPageByPath(['guias'])).resolves.toBeNull()
  })

  it('builds the sidebar from the groups that have guides, then the reference', async () => {
    const { getDevNav } = await loadWith({
      'webhooks.mdx': page(FM('webhooks', 1, 'Webhooks')),
      'comecando.mdx': page(FM('introducao', 1, 'Começando')),
    })

    await expect(getDevNav()).resolves.toEqual([
      {
        slug: 'introducao',
        label: 'Introdução',
        pages: [{ href: '/dev/comecando', title: 'Começando' }],
      },
      {
        slug: 'webhooks',
        label: 'Webhooks',
        pages: [{ href: '/dev/webhooks', title: 'Webhooks' }],
      },
      {
        slug: 'referencia',
        label: 'Referência',
        pages: [
          { href: '/dev/api', title: 'Referência da API' },
          { href: '/dev/api/v1', title: 'Referência da API v1' },
        ],
      },
    ])
  })

  it('links each guide to its neighbours in reading order', async () => {
    const { getAdjacentDevPages } = await loadWith({
      'a.mdx': page(FM('introducao', 1, 'Alfa')),
      'b.mdx': page(FM('fundamentos', 1, 'Beta')),
      'c.mdx': page(FM('recursos', 1, 'Gama')),
    })

    const middle = await getAdjacentDevPages('/dev/b')
    expect(middle.prev?.href).toBe('/dev/a')
    expect(middle.next?.href).toBe('/dev/c')

    const first = await getAdjacentDevPages('/dev/a')
    expect(first.prev).toBeNull()

    const last = await getAdjacentDevPages('/dev/c')
    expect(last.next).toBeNull()

    await expect(getAdjacentDevPages('/dev/nada')).resolves.toEqual({
      prev: null,
      next: null,
    })
  })

  it('indexes the landing, the guides with their headings and the reference', async () => {
    const { getDevSearchIndex } = await loadWith({
      'limites.mdx': page(FM('fundamentos', 3, 'Limites'), '## O 429'),
    })

    const index = await getDevSearchIndex()

    expect(index[1]).toEqual({
      href: '/dev/limites',
      title: 'Limites',
      description: 'Descrição longa o bastante da página 3.',
      section: 'Fundamentos',
      headings: [{ id: 'o-429', text: 'O 429' }],
    })
    expect(index.map((entry) => entry.section)).toEqual([
      'Introdução',
      'Fundamentos',
      'Referência',
      'Referência',
    ])
  })

  it.each([
    [
      'invalid frontmatter',
      { 'a.mdx': page('title: x\nsection: guias\norder: 1') },
      'Invalid frontmatter in content/dev/a.mdx',
    ],
    [
      'an unknown group',
      { 'a.mdx': page(FM('crm', 1)) },
      'Invalid frontmatter in content/dev/a.mdx',
    ],
    [
      'a file name that is not a slug',
      { 'guias/Novo Lead.mdx': page(FM('guias', 1)) },
      'Invalid dev page path: content/dev/guias/Novo Lead.mdx',
    ],
    [
      'the reserved api path',
      { 'api.mdx': page(FM('guias', 1)) },
      'Invalid dev page path: content/dev/api.mdx',
    ],
  ])('fails loudly on %s', async (_label, files, message) => {
    const { getAllDevPages } = await loadWith(files)
    await expect(getAllDevPages()).rejects.toThrow(message)
  })

  it('rethrows unexpected read errors', async () => {
    const { getAllDevPages } = await loadWith(null)
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' })
    vi.spyOn(fs, 'readdir').mockRejectedValueOnce(denied)
    await expect(getAllDevPages()).rejects.toThrow('denied')
  })
})
