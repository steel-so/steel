import { createId } from '@paralleldrive/cuid2'
import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

/** Site blog and collections (slice site-blog): API, public pages, feeds,
 * sitemap and route statuses. */

async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()).data as T
}

async function blogSite() {
  const { user, workspace } = await authenticatedOwner()
  const base = `/api/workspaces/${workspace.id}/crm/sites`
  const slug = `e2e-blog-${createId().slice(0, 10)}`
  const site = await json<{ id: string }>(
    await postJson(base, { name: 'Blog E2E', slug }, user.cookie),
  )
  const blog = `${base}/${site.id}/blog`
  const category = await json<{ id: string }>(
    await postJson(`${blog}/categories`, { name: 'Dicas' }, user.cookie),
  )
  const author = await json<{ id: string }>(
    await postJson(
      `${blog}/authors`,
      { name: 'Ana Souza', bio: 'Escreve' },
      user.cookie,
    ),
  )
  const post = await json<{ id: string; slug: string; status: string }>(
    await postJson(
      `${blog}/posts`,
      {
        title: 'Como escolher um plano',
        status: 'PUBLISHED',
        authorId: author.id,
        categoryIds: [category.id],
        newTags: ['Internet'],
        content: [
          { type: 'h2', children: [{ text: 'Velocidade' }] },
          { type: 'p', children: [{ text: 'Fibra para empresas <b>' }] },
        ],
        seo: {
          search: {
            questions: [{ question: 'Quanto custa?', answer: 'Depende.' }],
          },
        },
      },
      user.cookie,
    ),
  )
  await postJson(`${base}/${site.id}/publish`, {}, user.cookie)
  return { user, workspace, base, blog, slug, site, post, category, author }
}

describe('blog API', () => {
  it('creates, lists, updates and bulk-edits posts', async () => {
    const { user, blog, post } = await blogSite()
    expect(post.status).toBe('PUBLISHED')
    const draft = await json<{ id: string; slug: string }>(
      await postJson(`${blog}/posts`, { title: 'Rascunho' }, user.cookie),
    )
    const list = await json<{ total: number }>(
      await getJson(`${blog}/posts?status=DRAFT`, user.cookie),
    )
    expect(list.total).toBe(1)
    const updated = await patchJson(
      `${blog}/posts/${draft.id}`,
      { title: 'Rascunho 2', excerpt: 'Resumo' },
      user.cookie,
    )
    expect(updated.status).toBe(200)
    const bulk = await postJson(
      `${blog}/posts/bulk`,
      { ids: [draft.id], action: 'feature' },
      user.cookie,
    )
    expect((await json<{ affected: number }>(bulk)).affected).toBe(1)
    expect(
      (await getJson(`${blog}/posts/${draft.id}`, user.cookie)).status,
    ).toBe(200)
    expect(
      (await getJson(`${blog}/posts?status=NOPE`, user.cookie)).status,
    ).toBe(422)
    expect(
      (await postJson(`${blog}/posts`, { title: '' }, user.cookie)).status,
    ).toBe(422)
    expect(
      (await deleteJson(`${blog}/posts/${draft.id}`, user.cookie)).status,
    ).toBe(200)
    expect(
      (await getJson(`${blog}/posts/${draft.id}`, user.cookie)).status,
    ).toBe(404)
  })

  it('manages tags, templates and the editor preview', async () => {
    const { user, blog } = await blogSite()
    const tags = await json<Array<{ slug: string }>>(
      await getJson(`${blog}/tags`, user.cookie),
    )
    expect(tags.map((tag) => tag.slug)).toEqual(['internet'])
    const templates = await json<Array<{ name: string }>>(
      await postJson(`${blog}/templates`, {}, user.cookie),
    )
    expect(templates).toHaveLength(5)
    const preview = await json<{ sample: boolean }>(
      await getJson(`${blog}/preview`, user.cookie),
    )
    expect(preview.sample).toBe(false)
  })

  it('keeps viewers read-only and outsiders out', async () => {
    const { workspace, blog } = await blogSite()
    const viewer = await addMember(workspace.id, 'VIEWER')
    expect((await getJson(`${blog}/posts`, viewer.cookie)).status).toBe(200)
    expect(
      (await postJson(`${blog}/posts`, { title: 'X' }, viewer.cookie)).status,
    ).toBe(403)
    const outsider = await authenticatedOwner()
    expect((await getJson(`${blog}/posts`, outsider.user.cookie)).status).toBe(
      403,
    )
  })
})

describe('collections API', () => {
  it('creates a collection, its items and the item page', async () => {
    const { user, base, site, slug } = await blogSite()
    const collections = `${base}/${site.id}/collections`
    const collection = await json<{ id: string }>(
      await postJson(
        collections,
        {
          name: 'Vagas',
          itemName: 'Vaga',
          fields: [
            { key: 'local', label: 'Local', type: 'text', required: true },
          ],
        },
        user.cookie,
      ),
    )
    const invalid = await postJson(
      `${collections}/${collection.id}/items`,
      { title: 'Sem local' },
      user.cookie,
    )
    expect(invalid.status).toBe(422)
    const item = await json<{ id: string }>(
      await postJson(
        `${collections}/${collection.id}/items`,
        {
          title: 'Dev back-end',
          status: 'PUBLISHED',
          data: { local: 'Remoto' },
        },
        user.cookie,
      ),
    )
    expect(
      (
        await postJson(
          `${collections}/${collection.id}/template`,
          {},
          user.cookie,
        )
      ).status,
    ).toBe(200)
    await postJson(`${base}/${site.id}/publish`, {}, user.cookie)

    const page = await fetch(`${BASE_URL}/s/${slug}/vagas/dev-back-end`)
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('Dev back-end')
    expect(html).toContain('Remoto')
    expect((await fetch(`${BASE_URL}/s/${slug}/vagas/nada`)).status).toBe(404)

    const items = await json<unknown[]>(
      await getJson(`${collections}/${collection.id}/items`, user.cookie),
    )
    expect(items).toHaveLength(1)
    expect(
      (
        await patchJson(
          `${collections}/${collection.id}/items/${item.id}`,
          { status: 'DRAFT' },
          user.cookie,
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await postJson(
          `${collections}/${collection.id}/items/reorder`,
          { orderedIds: [item.id] },
          user.cookie,
        )
      ).status,
    ).toBe(200)
  })
})

describe('public blog pages', () => {
  it('renders the index, the post with JSON-LD and the archives', async () => {
    const { slug } = await blogSite()
    const index = await fetch(`${BASE_URL}/s/${slug}/blog`)
    expect(index.status).toBe(200)
    expect(await index.text()).toContain('Como escolher um plano')

    const post = await fetch(
      `${BASE_URL}/s/${slug}/blog/como-escolher-um-plano`,
    )
    expect(post.status).toBe(200)
    const html = await post.text()
    expect(html).toContain('<h1 class="s-t-h1">Como escolher um plano</h1>')
    expect(html).toContain('Fibra para empresas &lt;b&gt;')
    expect(html).toContain('"@type":"BlogPosting"')
    expect(html).toContain('"@type":"FAQPage"')
    expect(html).toContain('application/rss+xml')
    expect(html).toContain('og:type" content="article"')

    for (const path of [
      'blog/categoria/dicas',
      'blog/tag/internet',
      'blog/autor/ana-souza',
    ]) {
      expect((await fetch(`${BASE_URL}/s/${slug}/${path}`)).status).toBe(200)
    }
    const search = await fetch(`${BASE_URL}/s/${slug}/blog?busca=fibra`)
    expect(await search.text()).toContain('Resultados para')
    expect((await fetch(`${BASE_URL}/s/${slug}/blog/nao-existe`)).status).toBe(
      404,
    )
  })

  it('serves RSS and Atom feeds and lists posts in the sitemap', async () => {
    const { slug } = await blogSite()
    const rss = await fetch(`${BASE_URL}/s/${slug}/feed.xml`)
    expect(rss.status).toBe(200)
    expect(rss.headers.get('content-type')).toContain('application/rss+xml')
    const xml = await rss.text()
    expect(xml).toContain('<title>Como escolher um plano</title>')
    expect(xml).toContain('<category>Dicas</category>')
    const category = await (
      await fetch(`${BASE_URL}/s/${slug}/feed.xml?categoria=dicas`)
    ).text()
    expect(category).toContain('Blog E2E — Dicas')
    expect(
      (await fetch(`${BASE_URL}/s/${slug}/feed.xml?categoria=nada`)).status,
    ).toBe(404)
    const atom = await fetch(`${BASE_URL}/s/${slug}/atom.xml`)
    expect(atom.headers.get('content-type')).toContain('application/atom+xml')
    expect(await atom.text()).toContain(
      '<feed xmlns="http://www.w3.org/2005/Atom"',
    )
    const sitemap = await (
      await fetch(`${BASE_URL}/s/${slug}/sitemap.xml`)
    ).text()
    expect(sitemap).toContain('/blog/como-escolher-um-plano</loc>')
    const llms = await (await fetch(`${BASE_URL}/s/${slug}/llms.txt`)).text()
    expect(llms).toContain('## Blog')
    expect(llms).toContain('/blog/como-escolher-um-plano')
    expect(
      (
        await fetch(
          `${BASE_URL}/s/e2e-nao-existe-${createId().slice(0, 6)}/feed.xml`,
        )
      ).status,
    ).toBe(404)
  })

  it('takes a post off the site when it goes back to draft', async () => {
    const { slug, user, blog, post } = await blogSite()
    await patchJson(
      `${blog}/posts/${post.id}`,
      { status: 'DRAFT' },
      user.cookie,
    )
    expect(
      (await fetch(`${BASE_URL}/s/${slug}/blog/${post.slug}`)).status,
    ).toBe(404)
  })
})
