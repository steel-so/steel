import { describe, expect, it } from 'vitest'
import {
  renderSite,
  renderSiteEditing,
  siteDoc,
} from '@/src/__tests__/helpers/site-canvas'
import type { SiteCmsContext } from '@/src/lib/canvas-site/cms'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import { compileSiteCss } from '@/src/lib/canvas-site/css'
import {
  section,
  spec,
  toDocument,
} from '@/src/lib/canvas-site/presets/builder'
import { cmsCss } from '@/src/lib/canvas-site/styles-cms'
import {
  type CollectionField,
  formatItemValues,
  itemSummary,
  parseCollectionFields,
  parseItemData,
  referencedItemIds,
} from '@/src/lib/sites/blog/collections'
import {
  type BlogData,
  type BlogPostRecord,
  type CmsRequest,
  type CollectionRecord,
  cmsNeeds,
  cmsResolver,
  matchesSearch,
  normalizeSearch,
  pageWindow,
  paginate,
  relatedPosts,
  resolveCms,
} from '@/src/lib/sites/blog/resolve'

function post(id: string, extra: Partial<BlogPostRecord> = {}): BlogPostRecord {
  return {
    id,
    title: `Post ${id}`,
    slug: `post-${id}`,
    excerpt: `Resumo ${id}`,
    coverImageUrl: `/media/${id}.png`,
    coverImageAlt: null,
    publishedAt: '2026-10-10T12:00:00.000Z',
    updatedAt: '2026-10-11T12:00:00.000Z',
    readingMinutes: 4,
    featured: false,
    categoryIds: [],
    tagIds: [],
    authorId: null,
    searchText: normalizeSearch(`Post ${id} Resumo ${id}`),
    ...extra,
  }
}

const blog: BlogData = {
  posts: [
    post('1', {
      categoryIds: ['c1'],
      tagIds: ['t1'],
      authorId: 'a1',
      featured: true,
    }),
    post('2', { categoryIds: ['c1'], tagIds: [] }),
    post('3', { categoryIds: ['c2'], tagIds: ['t1'], authorId: 'a1' }),
    post('4', {
      title: 'Ação rápida',
      searchText: normalizeSearch('Ação rápida'),
    }),
  ],
  categories: [
    { id: 'c1', name: 'Dicas', slug: 'dicas', description: 'Boas dicas' },
    { id: 'c2', name: 'Notícias', slug: 'noticias' },
    { id: 'c3', name: 'Vazia', slug: 'vazia' },
  ],
  tags: [
    { id: 't1', name: 'seo', slug: 'seo' },
    { id: 't2', name: 'sem', slug: 'sem' },
  ],
  authors: [
    {
      id: 'a1',
      name: 'Ana',
      slug: 'ana',
      bio: 'Escreve',
      avatarUrl: '/media/ana.png',
      links: [{ network: 'linkedin', url: 'https://linkedin.com/in/ana' }],
    },
  ],
}

const fields: CollectionField[] = [
  { key: 'resumo', label: 'Resumo', type: 'text' },
  { key: 'sobre', label: 'Sobre', type: 'richtext' },
  { key: 'foto', label: 'Foto', type: 'image', required: true },
  { key: 'salario', label: 'Salário', type: 'number' },
  { key: 'inicio', label: 'Início', type: 'date' },
  { key: 'site', label: 'Site', type: 'link' },
  { key: 'area', label: 'Área', type: 'reference', collectionId: 'areas' },
  { key: 'plano', label: 'Plano', type: 'product' },
]

const collections: Record<string, CollectionRecord> = {
  vagas: {
    id: 'vagas',
    name: 'Vagas',
    slug: 'vagas',
    fields,
    hasTemplate: true,
    items: [
      {
        id: 'v2',
        title: 'Back-end',
        slug: 'back-end',
        data: {
          resumo: 'Node e Postgres',
          foto: { url: '/media/v.png', alt: 'Foto' },
          area: 'ar1',
        },
        position: 1,
        publishedAt: '2026-10-02T00:00:00.000Z',
      },
      {
        id: 'v1',
        title: 'Analista',
        slug: 'analista',
        data: { resumo: 'Dados', salario: 5000 },
        position: 0,
        publishedAt: '2026-10-05T00:00:00.000Z',
      },
    ],
  },
  areas: {
    id: 'areas',
    name: 'Áreas',
    slug: 'areas',
    fields: [],
    hasTemplate: false,
    items: [
      {
        id: 'ar1',
        title: 'Tecnologia',
        slug: 'tecnologia',
        data: {},
        position: 0,
        publishedAt: '2026-10-01T00:00:00.000Z',
      },
    ],
  },
}

const href = (path: string) => `/s/site${path}`

function request(extra: Partial<CmsRequest> = {}): CmsRequest {
  return {
    path: '/blog',
    blogRoute: { kind: 'index' },
    page: 1,
    query: '',
    ...extra,
  }
}

const list = (props: Record<string, unknown> = {}) =>
  spec(SITE_TYPES.postList, props)

describe('collections', () => {
  it('parses field definitions', () => {
    expect(parseCollectionFields(fields)).toHaveLength(8)
    expect(parseCollectionFields('x')).toEqual([])
    expect(
      parseCollectionFields([
        { key: 'a', label: 'A', type: 'text' },
        { key: 'a', label: 'B', type: 'text' },
      ]),
    ).toEqual([])
    expect(
      parseCollectionFields([{ key: 'r', label: 'R', type: 'reference' }]),
    ).toEqual([])
    expect(
      parseCollectionFields([{ key: 'title', label: 'T', type: 'text' }]),
    ).toEqual([])
    expect(parseCollectionFields(undefined)).toEqual([])
  })

  it('validates item data, drops unknown keys and sanitizes rich text', () => {
    const parsed = parseItemData(fields, {
      resumo: ' Texto ',
      sobre: '<p>Oi<script>x</script></p>',
      foto: { url: '/media/x.png', alt: 'X' },
      salario: 10,
      inicio: '2026-10-15',
      site: { url: 'https://x.com', label: 'X' },
      area: 'ar1',
      plano: { id: 'p1' },
      extra: 'fora',
      vazio: '',
    })
    expect(parsed).toEqual({
      ok: true,
      data: {
        resumo: 'Texto',
        sobre: '<p>Oi</p>',
        foto: { url: '/media/x.png', alt: 'X' },
        salario: 10,
        inicio: '2026-10-15',
        site: { url: 'https://x.com', label: 'X' },
        area: 'ar1',
        plano: { id: 'p1', name: '' },
      },
    })
  })

  it('reports invalid and missing values', () => {
    const parsed = parseItemData(fields, {
      foto: { url: '' },
      salario: 'dez',
      inicio: '2026-02-30x',
      site: { url: 'javascript:x' },
    })
    expect(parsed).toEqual({
      ok: false,
      errors: [
        'Foto: campo obrigatório',
        expect.stringMatching(/^Salário: /),
        'Início: Use o formato AAAA-MM-DD',
        'Site: Link inválido',
      ],
    })
    expect(
      parseItemData([{ key: 'foto', label: 'Foto', type: 'image' }], {
        foto: { url: 'javascript:x' },
      }),
    ).toEqual({ ok: false, errors: ['Foto: Imagem inválida'] })
    expect(
      parseItemData([{ key: 'd', label: 'D', type: 'date' }], {
        d: '2026-13-01',
      }),
    ).toEqual({ ok: false, errors: ['D: Data inválida'] })
    expect(
      parseItemData(fields, { foto: { url: '/a.png' }, resumo: null }),
    ).toMatchObject({ ok: true })
  })

  it('lists referenced items', () => {
    expect(referencedItemIds(fields, { area: 'ar1', resumo: 'x' })).toEqual([
      'ar1',
    ])
    expect(referencedItemIds(fields, {})).toEqual([])
  })

  it('formats values for the elements', () => {
    const values = formatItemValues(
      fields,
      {
        resumo: 'Texto',
        sobre: '<p>Rico</p>',
        foto: { url: '/media/x.png' },
        salario: 1234.5,
        inicio: '2026-10-15',
        site: { url: 'https://x.com/vaga' },
        area: 'ar1',
        plano: { id: 'p1', name: 'Plano Pro', price: 9990, currency: 'BRL' },
        vazio: '',
      },
      {
        references: new Map([
          ['ar1', { title: 'Tecnologia', href: '/areas/tec' }],
        ]),
      },
    )
    expect(values.resumo).toEqual({ type: 'text', text: 'Texto' })
    expect(values.sobre).toEqual({
      type: 'richtext',
      text: 'Rico',
      html: '<p>Rico</p>',
    })
    expect(values.foto).toEqual({
      type: 'image',
      text: '',
      url: '/media/x.png',
      alt: '',
    })
    expect(values.salario.text).toBe('1.234,5')
    expect(values.inicio.text).toBe('15 de outubro de 2026')
    expect(values.site).toEqual({
      type: 'link',
      text: 'x.com/vaga',
      url: 'https://x.com/vaga',
    })
    expect(values.area).toEqual({
      type: 'reference',
      text: 'Tecnologia',
      url: '/areas/tec',
    })
    expect(values.plano.text).toMatch(/^Plano Pro — R\$\s?99,90$/)
    const plain = formatItemValues(fields, {
      plano: { id: 'p', name: 'Sem preço', price: null },
      area: 'sumiu',
      site: { url: 'https://x.com', label: 'Rótulo' },
      foto: { url: '/a.png', alt: 'A' },
    })
    expect(plain.plano.text).toBe('Sem preço')
    expect(plain.area).toBeUndefined()
    expect(plain.site.text).toBe('Rótulo')
    expect(plain.foto.alt).toBe('A')
    expect(
      formatItemValues([{ key: 'p', label: 'P', type: 'product' }], {
        p: { id: 'p', name: 'Moeda', price: 100, currency: 'XX!' },
      }).p.text,
    ).toBe('Moeda — 1.00')
  })

  it('summarizes items', () => {
    expect(
      itemSummary(fields, { resumo: 'Curto', sobre: '<p>Longo</p>' }),
    ).toBe('Curto Longo')
    expect(itemSummary(fields, { resumo: 'a'.repeat(300) }, 10)).toBe(
      'aaaaaaaaa…',
    )
  })
})

describe('resolve helpers', () => {
  it('searches without accents and paginates', () => {
    expect(matchesSearch(blog.posts[3], 'acao')).toBe(true)
    expect(matchesSearch(blog.posts[3], 'acao lenta')).toBe(false)
    expect(paginate([1, 2, 3, 4, 5], 2, 3)).toEqual({
      items: [5],
      page: 3,
      pageCount: 3,
    })
    expect(paginate([1, 2], 2, 9)).toEqual({
      items: [1, 2],
      page: 1,
      pageCount: 1,
    })
    expect(paginate([], 2, 0)).toEqual({ items: [], page: 1, pageCount: 1 })
    expect(pageWindow(1, 3)).toEqual([1, 2, 3])
    expect(pageWindow(5, 10)).toEqual([1, 4, 5, 6, 10])
    expect(pageWindow(1, 10)).toEqual([1, 2, 10])
  })

  it('ranks related posts by shared categories and tags', () => {
    const related = relatedPosts(blog.posts, blog.posts[0], 3)
    expect(related.map((item) => item.id)).toEqual(['2', '3', '4'])
  })

  it('tells what a page needs', () => {
    const doc = toDocument([
      section({}, [
        list(),
        spec(SITE_TYPES.collectionList, { collectionId: 'vagas' }),
        spec(SITE_TYPES.collectionList, { collectionId: '' }),
        spec(SITE_TYPES.collectionField, {}),
      ]),
    ])
    expect(cmsNeeds([doc])).toEqual({
      blog: true,
      collectionIds: ['vagas'],
      itemFields: true,
    })
    expect(cmsNeeds([toDocument([section({}, [])])])).toEqual({
      blog: false,
      collectionIds: [],
      itemFields: false,
    })
  })
})

describe('resolveCms', () => {
  it('returns nothing (or only the blog link) without dynamic content', () => {
    const doc = siteDoc([])
    expect(
      resolveCms({
        docs: [doc],
        blog,
        request: request({ blogRoute: null }),
        href,
      }),
    ).toBeUndefined()
    expect(resolveCms({ docs: [doc], blog, request: request(), href })).toEqual(
      {
        blogHref: '/s/site/blog',
      },
    )
    expect(
      resolveCms({
        docs: [doc],
        blog,
        request: request({ blogRoute: null, query: 'x' }),
        href,
      }),
    ).toEqual({ blogHref: '/s/site/blog' })
  })

  it('resolves latest, featured, filtered and paginated lists', () => {
    const doc = siteDoc([
      list({ perPage: 2, pagination: true }),
      list({ source: 'featured' }),
      list({ categorySlug: 'dicas' }),
      list({ tagSlug: 'seo' }),
      list({ categorySlug: 'nada', tagSlug: 'nada' }),
    ])
    const ids = Object.values(doc.nodes)
      .filter((node) => node.type === SITE_TYPES.postList)
      .map((node) => node.id)
    const cms = resolveCms({
      docs: [doc],
      blog,
      request: request({ page: 2, query: '' }),
      href,
      timezone: 'UTC',
    }) as SiteCmsContext
    const [paged, featured, category, tag, none] = ids.map(
      (id) => cms.lists?.[id],
    )
    expect(paged?.posts.map((item) => item.id)).toEqual(['3', '4'])
    expect(paged).toMatchObject({
      page: 2,
      pageCount: 2,
      total: 4,
      prevHref: '/s/site/blog',
      nextHref: undefined,
      pages: [
        { page: 1, href: '/s/site/blog' },
        { page: 2, href: '/s/site/blog?pagina=2' },
      ],
    })
    expect(featured?.posts.map((item) => item.id)).toEqual(['1'])
    expect(featured?.pageCount).toBe(1)
    expect(category?.posts.map((item) => item.id)).toEqual(['1', '2'])
    expect(tag?.posts.map((item) => item.id)).toEqual(['1', '3'])
    expect(none?.posts).toEqual([])
    const card = category?.posts[0]
    expect(card).toMatchObject({
      href: '/s/site/blog/post-1',
      dateLabel: '10 de outubro de 2026',
      categories: [
        { name: 'Dicas', href: '/s/site/blog/categoria/dicas', count: 2 },
      ],
      tags: [{ name: 'seo', href: '/s/site/blog/tag/seo' }],
      author: { name: 'Ana', href: '/s/site/blog/autor/ana' },
    })
    expect(cms.categories?.map((term) => term.slug)).toEqual([
      'dicas',
      'noticias',
    ])
    expect(cms.tags?.map((term) => term.slug)).toEqual(['seo'])
    expect(cms.archive).toEqual({ kind: 'index', title: 'Blog' })
  })

  it('follows the archive of category, tag, author and search routes', () => {
    const doc = siteDoc([
      list({ source: 'archive', pagination: true, perPage: 1 }),
    ])
    const id = Object.values(doc.nodes).find(
      (node) => node.type === SITE_TYPES.postList,
    )?.id as string
    const run = (extra: Partial<CmsRequest>) =>
      resolveCms({
        docs: [doc],
        blog,
        request: request(extra),
        href,
      }) as SiteCmsContext
    const category = run({
      blogRoute: { kind: 'category', slug: 'dicas' },
      path: '/blog/categoria/dicas',
    })
    expect(category.archive).toEqual({
      kind: 'category',
      title: 'Dicas',
      description: 'Boas dicas',
    })
    expect(category.lists?.[id]).toMatchObject({
      total: 2,
      nextHref: '/s/site/blog/categoria/dicas?pagina=2',
    })
    const tag = run({ blogRoute: { kind: 'tag', slug: 'seo' } })
    expect(tag.archive).toEqual({ kind: 'tag', title: '#seo' })
    expect(tag.lists?.[id].total).toBe(2)
    const author = run({ blogRoute: { kind: 'author', slug: 'ana' } })
    expect(author.archive).toMatchObject({
      kind: 'author',
      title: 'Posts de Ana',
      description: 'Escreve',
    })
    expect(author.author?.name).toBe('Ana')
    expect(author.lists?.[id].total).toBe(2)
    const search = run({ query: 'acao', path: '/blog' })
    expect(search.archive).toEqual({
      kind: 'search',
      title: 'Resultados para “acao”',
    })
    expect(search.lists?.[id].total).toBe(1)
    expect(search.query).toBe('acao')
    const byIds = run({ query: 'qualquer', searchIds: ['2', '3'] })
    expect(byIds.lists?.[id].total).toBe(2)
    expect(
      run({ blogRoute: { kind: 'category', slug: 'x' } }).archive,
    ).toBeUndefined()
    expect(
      run({ blogRoute: { kind: 'tag', slug: 'x' } }).archive,
    ).toBeUndefined()
    expect(
      run({ blogRoute: { kind: 'author', slug: 'x' } }).archive,
    ).toBeUndefined()
    expect(
      run({ blogRoute: { kind: 'category', slug: 'x' } }).lists?.[id].total,
    ).toBe(0)
    expect(
      run({ blogRoute: { kind: 'tag', slug: 'x' } }).lists?.[id].total,
    ).toBe(0)
    expect(
      run({ blogRoute: { kind: 'author', slug: 'x' } }).lists?.[id].total,
    ).toBe(0)
    expect(
      run({ blogRoute: { kind: 'post', slug: 'post-1' } }).archive,
    ).toBeUndefined()
    expect(run({ blogRoute: null }).archive).toBeUndefined()
  })

  it('resolves the current post and its related posts', () => {
    const doc = siteDoc([
      spec(SITE_TYPES.post, {}),
      list({ source: 'related', perPage: 2 }),
    ])
    const id = Object.values(doc.nodes).find(
      (node) => node.type === SITE_TYPES.postList,
    )?.id as string
    const cms = resolveCms({
      docs: [doc],
      blog,
      request: request({
        blogRoute: { kind: 'post', slug: 'post-1' },
        post: { ...blog.posts[0], html: '<p>Corpo</p>', faq: [] },
      }),
      href,
    }) as SiteCmsContext
    expect(cms.post).toMatchObject({
      title: 'Post 1',
      html: '<p>Corpo</p>',
      updatedLabel: '11 de outubro de 2026',
    })
    expect(cms.lists?.[id].posts.map((item) => item.id)).toEqual(['2', '3'])
    const noPost = resolveCms({
      docs: [doc],
      blog,
      request: request(),
      href,
    }) as SiteCmsContext
    expect(noPost.lists?.[id].posts).toHaveLength(2)
  })

  it('resolves collection lists, references and the current item', () => {
    const doc = siteDoc([
      spec(SITE_TYPES.collectionList, {
        collectionId: 'vagas',
        sort: 'position',
      }),
      spec(SITE_TYPES.collectionList, {
        collectionId: 'vagas',
        sort: 'newest',
        limit: 1,
      }),
      spec(SITE_TYPES.collectionList, { collectionId: 'vagas', sort: 'title' }),
      spec(SITE_TYPES.collectionList, { collectionId: 'nenhuma' }),
      spec(SITE_TYPES.collectionField, {}),
    ])
    const ids = Object.values(doc.nodes)
      .filter((node) => node.type === SITE_TYPES.collectionList)
      .map((node) => node.id)
    const cms = resolveCms({
      docs: [doc],
      collections,
      request: request({
        blogRoute: null,
        item: { collectionId: 'vagas', itemId: 'v2' },
      }),
      href,
    }) as SiteCmsContext
    expect(cms.collections?.[ids[0]].items.map((item) => item.id)).toEqual([
      'v1',
      'v2',
    ])
    expect(cms.collections?.[ids[1]].items.map((item) => item.id)).toEqual([
      'v1',
    ])
    expect(cms.collections?.[ids[2]].items.map((item) => item.title)).toEqual([
      'Analista',
      'Back-end',
    ])
    expect(cms.collections?.[ids[3]]).toBeUndefined()
    expect(cms.lists).toBeUndefined()
    expect(cms.item).toMatchObject({
      title: 'Back-end',
      href: '/s/site/vagas/back-end',
      values: {
        area: { type: 'reference', text: 'Tecnologia', url: undefined },
      },
    })
    const missing = resolveCms({
      docs: [doc],
      collections,
      request: request({
        blogRoute: null,
        item: { collectionId: 'vagas', itemId: 'x' },
      }),
      href,
    }) as SiteCmsContext
    expect(missing.item).toBeUndefined()
    expect(
      (
        resolveCms({
          docs: [doc],
          request: request({ blogRoute: null }),
          href,
        }) as SiteCmsContext
      ).collections,
    ).toEqual({})
  })

  it('exposes live list functions for the editor (sample data keeps empty terms)', () => {
    const cms = cmsResolver({
      blog,
      collections,
      request: request(),
      href,
      sample: true,
    })
    expect(cms.sample).toBe(true)
    expect(cms.categories).toHaveLength(3)
    expect(
      cms.postList?.('n', {
        source: 'latest',
        layout: 'grid',
        columns: 3,
        perPage: 2,
        pagination: false,
        featuredFirst: false,
        showCover: true,
        showExcerpt: true,
        showDate: true,
        showAuthor: true,
        showCategories: true,
        showReadingTime: true,
        showArchiveHeader: false,
        titleLevel: 'h3',
        aspectRatio: '16/9',
        gap: 24,
        emptyText: '',
      } as never).posts,
    ).toHaveLength(2)
    expect(
      cms.collectionList?.('n', {
        collectionId: 'vagas',
        sort: 'position',
        limit: 5,
      } as never)?.items,
    ).toHaveLength(2)
    expect(
      cms.collectionList?.('n', { collectionId: 'x' } as never),
    ).toBeUndefined()
    expect(cmsResolver({ request: request(), href }).postList).toBeUndefined()
  })
})

describe('blog and collection elements', () => {
  const cms = (
    doc: ReturnType<typeof siteDoc>,
    extra: Partial<CmsRequest> = {},
    opts: { sample?: boolean } = {},
  ) =>
    resolveCms({
      docs: [doc],
      blog,
      collections,
      request: request(extra),
      href,
      timezone: 'UTC',
      ...opts,
    })

  it('renders a post list with cards, header and pager', () => {
    const doc = siteDoc([
      list({
        source: 'archive',
        perPage: 1,
        pagination: true,
        featuredFirst: true,
        showAuthor: true,
        showArchiveHeader: true,
        layout: 'list',
      }),
    ])
    const html = renderSite(doc, {
      cms: cms(doc, {
        page: 2,
        blogRoute: { kind: 'category', slug: 'dicas' },
        path: '/blog/categoria/dicas',
      }),
    })
    expect(html).toContain('class="s-plist s-plist-list')
    expect(html).toContain('<h1 class="s-t-h2">Dicas</h1><p>Boas dicas</p>')
    expect(html).toContain(
      '<h3 class="s-pcard-title"><a href="/s/site/blog/post-2">Post 2</a></h3>',
    )
    expect(html).toContain(
      '<time dateTime="2026-10-10T12:00:00.000Z">10 de outubro de 2026</time>',
    )
    expect(html).toContain('<span>4 min de leitura</span>')
    expect(html).toContain(
      '<nav class="s-pager" aria-label="Paginação"><a href="/s/site/blog/categoria/dicas" rel="prev">Anteriores</a>',
    )
    expect(html).toContain('aria-current="page"')
    expect(html).not.toContain('s-pcard-lead')
  })

  it('marks the lead card on page one and hides meta when asked', () => {
    const doc = siteDoc([
      list({
        featuredFirst: true,
        showCover: false,
        showExcerpt: false,
        showDate: false,
        showReadingTime: false,
        showCategories: false,
      }),
    ])
    const html = renderSite(doc, { cms: cms(doc) })
    expect(html).toContain('s-pcard s-pcard-lead')
    expect(html).not.toContain('s-pcard-media')
    expect(html).not.toContain('s-pmeta')
    expect(html).not.toContain('s-pcard-excerpt')
  })

  it('shows empty states', () => {
    const doc = siteDoc([
      list({ categorySlug: 'vazia' }),
      list({ categorySlug: 'vazia', emptyText: '' }),
    ])
    expect(renderSite(doc, { cms: cms(doc) })).toContain(
      '<p class="s-plist-empty">Nenhum post publicado ainda.</p>',
    )
    expect(renderSite(doc)).toContain('Nenhum post publicado ainda.')
    expect(renderSiteEditing(doc)).toContain(
      'Os posts publicados do blog aparecem aqui',
    )
    expect(
      renderSiteEditing(doc, {
        cms: { ...cms(doc), sample: true } as SiteCmsContext,
      }),
    ).toContain('Nenhum post publicado ainda.')
  })

  it('renders the current post with FAQ, tags and updated date', () => {
    const doc = siteDoc([spec(SITE_TYPES.post, { align: 'center' })])
    const context = {
      cms: cms(doc, {
        blogRoute: { kind: 'post', slug: 'post-1' },
        post: {
          ...blog.posts[0],
          coverImageAlt: 'Capa',
          html: '<p>Corpo</p>',
          faq: [{ question: 'Pergunta?', answer: 'Resposta.' }],
        },
      }),
    }
    const html = renderSite(doc, context)
    expect(html).toContain('<h1 class="s-t-h1">Post 1</h1>')
    expect(html).toContain('<p class="s-post-lead s-t-lead">Resumo 1</p>')
    expect(html).toContain('por <a href="/s/site/blog/autor/ana">Ana</a>')
    expect(html).toContain('Atualizado em')
    expect(html).toContain('<img src="/media/1.png" alt="Capa"')
    expect(html).toContain('<div class="s-post-body"><p>Corpo</p></div>')
    expect(html).toContain('<summary>Pergunta?</summary><p>Resposta.</p>')
    expect(html).toContain('class="s-ptags"')
    const minimal = siteDoc([
      spec(SITE_TYPES.post, {
        showTitle: false,
        showMeta: false,
        showCover: false,
        showExcerpt: false,
        showTags: false,
        showFaq: false,
        showUpdated: false,
      }),
    ])
    const bare = renderSite(minimal, context)
    expect(bare).not.toContain('<h1')
    expect(bare).not.toContain('s-post-faq')
    expect(bare).not.toContain('s-post-foot')
    expect(renderSite(doc)).not.toContain('s-post')
    expect(renderSiteEditing(doc)).toContain('O conteúdo do post aparece aqui')
  })

  it('renders categories/tags lists of the blog and of the post', () => {
    const doc = siteDoc([
      spec(SITE_TYPES.postTerms, {}),
      spec(SITE_TYPES.postTerms, {
        taxonomy: 'tags',
        display: 'chips',
        title: '',
      }),
      spec(SITE_TYPES.postTerms, { scope: 'post' }),
      spec(SITE_TYPES.postTerms, { scope: 'post', taxonomy: 'tags' }),
    ])
    const html = renderSite(doc, {
      cms: cms(doc, {
        blogRoute: { kind: 'post', slug: 'post-1' },
        post: { ...blog.posts[0], html: '', faq: [] },
      }),
    })
    expect(html).toContain('<p class="s-pterms-title">Categorias</p>')
    expect(html).toContain('Dicas<span class="s-pterms-count"> (2)</span>')
    expect(html).toContain('aria-label="Tags"')
    expect(html).toContain('s-pterms-chips')
    expect(renderSite(doc)).not.toContain('s-pterms')
    expect(renderSiteEditing(doc)).toContain('As tags do blog aparecem aqui')
  })

  it('renders the blog search form', () => {
    const doc = siteDoc([
      spec(SITE_TYPES.blogSearch, { label: '', buttonLabel: '' }),
    ])
    const html = renderSite(doc, { cms: cms(doc, { query: 'seo' }) })
    expect(html).toContain('action="/s/site/blog"')
    expect(html).toContain('name="busca"')
    expect(html).toContain('value="seo"')
    expect(html).toContain('>Buscar</button>')
    expect(renderSite(doc)).toContain('action="/blog"')
  })

  it('renders the author box', () => {
    const doc = siteDoc([spec(SITE_TYPES.postAuthor, { layout: 'column' })])
    const html = renderSite(doc, {
      cms: cms(doc, { blogRoute: { kind: 'author', slug: 'ana' } }),
    })
    expect(html).toContain('s-author s-author-column')
    expect(html).toContain(
      '<a href="/s/site/blog/autor/ana" rel="author">Ana</a>',
    )
    expect(html).toContain('<p class="s-author-bio">Escreve</p>')
    expect(html).toContain('href="https://linkedin.com/in/ana"')
    const plain = siteDoc([
      spec(SITE_TYPES.postAuthor, {
        showAvatar: false,
        showBio: false,
        showLinks: false,
        linkName: false,
      }),
    ])
    const author = {
      blogHref: '/blog',
      author: {
        id: 'x',
        name: 'Bia',
        slug: 'bia',
        href: '/b',
        links: [
          { network: 'site', url: 'https://bia.dev' },
          { network: 'x', url: 'javascript:x' },
        ],
      },
    }
    expect(renderSite(plain, { cms: author })).toContain(
      '<p class="s-author-name">Bia</p>',
    )
    const withLinks = siteDoc([spec(SITE_TYPES.postAuthor, {})])
    const links = renderSite(withLinks, { cms: author })
    expect(links).toContain('bia.dev')
    expect(links).not.toContain('javascript')
    expect(
      renderSite(withLinks, {
        cms: { blogHref: '/blog', author: { ...author.author, links: [] } },
      }),
    ).not.toContain('s-author-links')
    expect(renderSite(withLinks)).not.toContain('s-author')
    expect(renderSiteEditing(withLinks)).toContain(
      'O autor do post aparece aqui',
    )
  })

  it('renders collection lists and item fields', () => {
    const doc = siteDoc([
      spec(SITE_TYPES.collectionList, {
        collectionId: 'vagas',
        imageField: 'foto',
        textField: 'resumo',
        metaField: 'salario',
        showButton: true,
        buttonLabel: '',
      }),
      spec(SITE_TYPES.collectionList, {
        collectionId: 'areas',
        layout: 'list',
        textField: 'nada',
      }),
      spec(SITE_TYPES.collectionField, { fieldKey: 'title' }),
      spec(SITE_TYPES.collectionField, {
        fieldKey: 'resumo',
        display: 'auto',
        label: 'Resumo:',
      }),
      spec(SITE_TYPES.collectionField, { fieldKey: 'foto', display: 'auto' }),
      spec(SITE_TYPES.collectionField, { fieldKey: 'area', display: 'auto' }),
    ])
    const html = renderSite(doc, {
      cms: cms(doc, {
        blogRoute: null,
        item: { collectionId: 'vagas', itemId: 'v2' },
      }),
    })
    expect(html).toContain('<a href="/s/site/vagas/back-end">Back-end</a>')
    expect(html).toContain('<p class="s-pmeta">5.000</p>')
    expect(html).toContain('<p class="s-pcard-excerpt">Node e Postgres</p>')
    expect(html).toContain('Ver mais<span class="s-sr">: Back-end</span>')
    expect(html).toContain('s-plist s-plist-list')
    expect(html).toContain('<h1 class="s-t-h1 s-cfield')
    expect(html).toContain(
      '<span class="s-cfield-label">Resumo: </span>Node e Postgres',
    )
    expect(html).toContain('<img src="/media/v.png" alt="Foto"')
    expect(html).toContain('s-cfield-reference')
    expect(html).toContain('Tecnologia')
  })

  it('renders rich text, links and products of an item', () => {
    const doc = siteDoc([
      spec(SITE_TYPES.collectionField, { fieldKey: 'sobre', display: 'auto' }),
      spec(SITE_TYPES.collectionField, {
        fieldKey: 'site',
        display: 'heading',
      }),
      spec(SITE_TYPES.collectionField, {
        fieldKey: 'salario',
        display: 'auto',
      }),
      spec(SITE_TYPES.collectionList, {
        collectionId: 'vagas',
        textField: 'sobre',
      }),
    ])
    const values = {
      sobre: { type: 'richtext' as const, text: 'Rico', html: '<p>Rico</p>' },
      site: { type: 'link' as const, text: 'Abrir', url: 'https://x.com' },
      salario: { type: 'number' as const, text: '10' },
    }
    const html = renderSite(doc, {
      cms: {
        blogHref: '/blog',
        item: { id: 'i', title: 'I', slug: 'i', values },
        collections: {
          [Object.values(doc.nodes).find(
            (n) => n.type === SITE_TYPES.collectionList,
          )?.id as string]: {
            collectionName: 'Vagas',
            items: [{ id: 'i', title: 'I', slug: 'i', values }],
          },
        },
      },
    })
    expect(html).toContain('<div class="s-rich"><p>Rico</p></div>')
    expect(html).toContain('<a href="https://x.com">Abrir</a>')
    expect(html).toContain('<p class="s-cfield s-cfield-number">10</p>')
    expect(html).toContain('<h3 class="s-pcard-title">I</h3>')
    const linkless = siteDoc([
      spec(SITE_TYPES.collectionField, { fieldKey: 'site' }),
    ])
    expect(
      renderSite(linkless, {
        cms: {
          blogHref: '/blog',
          item: {
            id: 'i',
            title: 'I',
            slug: 'i',
            values: { site: { type: 'product', text: 'Plano' } },
          },
        },
      }),
    ).toContain('Plano')
    expect(
      renderSite(linkless, {
        cms: {
          blogHref: '/blog',
          item: {
            id: 'i',
            title: 'I',
            slug: 'i',
            values: { site: { type: 'image', text: '', url: 'javascript:x' } },
          },
        },
      }),
    ).not.toContain('<img')
  })

  it('shows collection empty states', () => {
    const doc = siteDoc([
      spec(SITE_TYPES.collectionList, { collectionId: 'vagas' }),
      spec(SITE_TYPES.collectionList, { collectionId: '', emptyText: '' }),
      spec(SITE_TYPES.collectionField, { fieldKey: 'resumo' }),
      spec(SITE_TYPES.collectionField, { fieldKey: '' }),
    ])
    expect(renderSite(doc)).toContain('Nenhum item publicado ainda.')
    const editing = renderSiteEditing(doc)
    expect(editing).toContain('Os itens publicados da coleção aparecem aqui')
    expect(editing).toContain('Escolha uma coleção no painel à direita')
    expect(editing).toContain('Valor do campo “resumo” de cada item')
    expect(editing).toContain('Escolha um campo no painel à direita')
  })
})

describe('CMS styles', () => {
  it('adds structural CSS only for the elements used', () => {
    expect(cmsCss(new Set(['site.heading']))).toBe('')
    const css = cmsCss(new Set([SITE_TYPES.post, SITE_TYPES.postList]))
    expect(css).toContain('.s-post-body')
    expect(css).toContain('.s-pager')
    expect(css).not.toContain('.s-bsearch')
    const all = cmsCss(
      new Set([
        SITE_TYPES.postTerms,
        SITE_TYPES.blogSearch,
        SITE_TYPES.postAuthor,
        SITE_TYPES.collectionField,
        SITE_TYPES.collectionList,
      ]),
    )
    expect(all).toContain('.s-bsearch')
    expect(all).toContain('.s-author')
    expect(all).toContain('.s-cfield-label')
  })

  it('compiles node classes for every CMS element', () => {
    const doc = siteDoc([
      list({
        columns: { base: 3, mobile: 1 },
        gap: 16,
        aspectRatio: 'auto',
        radius: { all: 8 },
        background: 'token:surface',
      }),
      list({ layout: 'list' }),
      spec(SITE_TYPES.post, {
        maxWidth: { value: 700, unit: 'px' },
        align: 'right',
      }),
      spec(SITE_TYPES.post, { maxWidth: undefined }),
      spec(SITE_TYPES.postTerms, { gap: 12 }),
      spec(SITE_TYPES.blogSearch, {}),
      spec(SITE_TYPES.postAuthor, { background: 'token:surface' }),
      spec(SITE_TYPES.collectionList, { layout: 'list' }),
      spec(SITE_TYPES.collectionField, {
        align: 'center',
        color: 'token:primary',
      }),
    ])
    const css = compileSiteCss(doc)
    expect(css).toContain('grid-template-columns:repeat(3, minmax(0, 1fr))')
    expect(css).toContain('max-width:700px')
    expect(css).toContain('margin-left:auto;margin-right:0')
    expect(css).toContain('text-align:center')
    expect(css).toContain('.s-post-body')
  })
})
