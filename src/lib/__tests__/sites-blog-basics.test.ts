import { describe, expect, it } from 'vitest'
import { createFakeSnapshot } from '@/src/__tests__/factories/site.factory'
import { analyzePost, postSearchDocument } from '@/src/lib/sites/blog/analysis'
import {
  escapeXml,
  FEED_LIMIT,
  type FeedChannel,
  renderAtom,
  renderRss,
} from '@/src/lib/sites/blog/feeds'
import {
  formatSiteDate,
  formatSiteDateTime,
  isoToSiteLocal,
  siteLocalToIso,
} from '@/src/lib/sites/blog/format'
import { postJsonLd, withGraphNodes } from '@/src/lib/sites/blog/jsonld'
import { renderLlmsSections, withLlmsSections } from '@/src/lib/sites/blog/llms'
import {
  BLOG_BASE,
  blogPath,
  collectionItemPath,
  firstFreeSlug,
  pageNumber,
  parseBlogRoute,
  parseCollectionRoute,
  searchTerm,
  withQuery,
} from '@/src/lib/sites/blog/routes'
import {
  snapshotTemplateKeys,
  templateDocument,
  virtualPage,
} from '@/src/lib/sites/blog/runtime'
import { sampleBlogData, samplePostBody } from '@/src/lib/sites/blog/sample'
import { isPostLive, resolvePublication } from '@/src/lib/sites/blog/schedule'
import {
  BLOG_TEMPLATE_KEYS,
  collectionIdOfTemplate,
  collectionTemplateKey,
  defaultBlogTemplate,
  defaultCollectionTemplate,
  isBlogTemplateKey,
  isTemplateKey,
  templateLabel,
} from '@/src/lib/sites/blog/templates'
import { validateSiteDocument } from '@/src/lib/sites/document'

describe('blog routes', () => {
  it('parses the blog index, posts and archives', () => {
    expect(parseBlogRoute(['Blog'])).toEqual({ kind: 'index' })
    expect(parseBlogRoute(['blog', 'meu-post'])).toEqual({
      kind: 'post',
      slug: 'meu-post',
    })
    expect(parseBlogRoute(['blog', 'categoria', 'dicas'])).toEqual({
      kind: 'category',
      slug: 'dicas',
    })
    expect(parseBlogRoute(['blog', 'tag', 'seo'])).toEqual({
      kind: 'tag',
      slug: 'seo',
    })
    expect(parseBlogRoute(['blog', 'autor', 'ana'])).toEqual({
      kind: 'author',
      slug: 'ana',
    })
  })

  it('rejects other shapes', () => {
    expect(parseBlogRoute([])).toBeNull()
    expect(parseBlogRoute(['sobre'])).toBeNull()
    expect(parseBlogRoute(['blog', 'categoria'])).toBeNull()
    expect(parseBlogRoute(['blog', 'Não Slug'])).toBeNull()
    expect(parseBlogRoute(['blog', 'x', 'y'])).toBeNull()
    expect(parseBlogRoute(['blog', 'tag', 'a b'])).toBeNull()
    expect(parseBlogRoute(['blog', 'tag', 'a', 'b'])).toBeNull()
  })

  it('builds paths', () => {
    expect(blogPath({ kind: 'index' })).toBe(`/${BLOG_BASE}`)
    expect(blogPath({ kind: 'post', slug: 'a' })).toBe('/blog/a')
    expect(blogPath({ kind: 'category', slug: 'b' })).toBe('/blog/categoria/b')
    expect(blogPath({ kind: 'tag', slug: 'c' })).toBe('/blog/tag/c')
    expect(blogPath({ kind: 'author', slug: 'd' })).toBe('/blog/autor/d')
    expect(collectionItemPath('vagas', 'dev')).toBe('/vagas/dev')
  })

  it('parses collection item paths', () => {
    expect(parseCollectionRoute(['Vagas', 'dev-back'])).toEqual({
      collectionSlug: 'vagas',
      itemSlug: 'dev-back',
    })
    expect(parseCollectionRoute(['vagas'])).toBeNull()
    expect(parseCollectionRoute(['blog', 'x'])).toBeNull()
    expect(parseCollectionRoute(['va gas', 'x'])).toBeNull()
  })

  it('reads page numbers and search terms', () => {
    expect(pageNumber(undefined)).toBe(1)
    expect(pageNumber('3')).toBe(3)
    expect(pageNumber(['4', '5'])).toBe(4)
    expect(pageNumber('0')).toBe(1)
    expect(pageNumber('2.5')).toBe(1)
    expect(pageNumber('99999')).toBe(1)
    expect(searchTerm(undefined)).toBe('')
    expect(searchTerm(['  a   b ', 'c'])).toBe('a b')
    expect(searchTerm('x'.repeat(200))).toHaveLength(100)
  })

  it('builds query strings without empty values or page 1', () => {
    expect(withQuery('/blog', { pagina: 1, busca: '' })).toBe('/blog')
    expect(withQuery('/blog', { pagina: 2, busca: 'a b', x: undefined })).toBe(
      '/blog?pagina=2&busca=a+b',
    )
  })

  it('finds the first free slug', () => {
    expect(firstFreeSlug('a', [])).toBe('a')
    expect(firstFreeSlug('a', ['a', 'a-2'])).toBe('a-3')
    expect(firstFreeSlug('abcdef-', ['abcdef'], 6)).toBe('abcd-2')
    const used = Array.from({ length: 500 }, (_, i) =>
      i === 0 ? 'x' : `x-${i + 1}`,
    )
    expect(firstFreeSlug('x', used)).toMatch(/^x-[a-z0-9]+$/)
  })
})

describe('publication rules', () => {
  const now = new Date('2026-10-15T12:00:00Z')
  const past = new Date('2026-10-01T12:00:00Z')
  const future = new Date('2026-10-20T12:00:00Z')

  it('keeps drafts with their date', () => {
    expect(resolvePublication({ status: 'DRAFT' }, null, now)).toEqual({
      ok: true,
      status: 'DRAFT',
      publishedAt: null,
    })
    expect(
      resolvePublication(
        { status: 'DRAFT' },
        { status: 'PUBLISHED', publishedAt: past },
        now,
      ),
    ).toMatchObject({ publishedAt: past })
    expect(
      resolvePublication({ status: 'DRAFT', publishedAt: future }, null, now),
    ).toMatchObject({ status: 'DRAFT', publishedAt: future })
  })

  it('schedules future dates and publishes due ones', () => {
    expect(
      resolvePublication(
        { status: 'SCHEDULED', publishedAt: future },
        null,
        now,
      ),
    ).toMatchObject({ status: 'SCHEDULED' })
    expect(
      resolvePublication({ status: 'SCHEDULED', publishedAt: past }, null, now),
    ).toMatchObject({ status: 'PUBLISHED' })
    expect(
      resolvePublication(
        { status: 'SCHEDULED' },
        { status: 'DRAFT', publishedAt: future },
        now,
      ),
    ).toMatchObject({ status: 'SCHEDULED', publishedAt: future })
    expect(resolvePublication({ status: 'SCHEDULED' }, null, now)).toEqual({
      ok: false,
      message: 'Informe a data de publicação',
    })
  })

  it('publishes now, keeps the original date or schedules', () => {
    expect(
      resolvePublication({ status: 'PUBLISHED' }, null, now),
    ).toMatchObject({
      status: 'PUBLISHED',
      publishedAt: now,
    })
    expect(
      resolvePublication(
        { status: 'PUBLISHED' },
        { status: 'DRAFT', publishedAt: past },
        now,
      ),
    ).toMatchObject({ publishedAt: past })
    expect(
      resolvePublication(
        { status: 'PUBLISHED', publishedAt: null },
        { status: 'SCHEDULED', publishedAt: future },
        now,
      ),
    ).toMatchObject({ status: 'PUBLISHED', publishedAt: now })
    expect(
      resolvePublication(
        { status: 'PUBLISHED', publishedAt: future },
        null,
        now,
      ),
    ).toMatchObject({ status: 'SCHEDULED' })
  })

  it('tells when a post is live', () => {
    expect(isPostLive({ status: 'DRAFT', publishedAt: past }, now)).toBe(false)
    expect(isPostLive({ status: 'PUBLISHED', publishedAt: null }, now)).toBe(
      false,
    )
    expect(isPostLive({ status: 'PUBLISHED', publishedAt: past }, now)).toBe(
      true,
    )
    expect(isPostLive({ status: 'SCHEDULED', publishedAt: past }, now)).toBe(
      true,
    )
    expect(isPostLive({ status: 'SCHEDULED', publishedAt: future }, now)).toBe(
      false,
    )
  })
})

describe('dates in the site timezone', () => {
  it('formats dates and date-times', () => {
    expect(formatSiteDate('2026-10-15T02:00:00Z')).toBe('14 de outubro de 2026')
    expect(formatSiteDate('2026-10-15T02:00:00Z', 'UTC')).toBe(
      '15 de outubro de 2026',
    )
    expect(formatSiteDate('2026-10-15T02:00:00Z', 'Mars/Base')).toBe(
      '14 de outubro de 2026',
    )
    expect(formatSiteDate('nope')).toBe('')
    expect(formatSiteDateTime('2026-10-15T15:30:00Z')).toBe('15/10/2026, 12:30')
    expect(formatSiteDateTime('2026-10-15T15:30:00Z', 'Mars/Base')).toBe(
      '15/10/2026, 12:30',
    )
    expect(formatSiteDateTime('x')).toBe('')
  })

  it('converts datetime-local values both ways', () => {
    expect(siteLocalToIso('2026-10-15T09:00')).toBe('2026-10-15T12:00:00.000Z')
    expect(siteLocalToIso('2026-10-15T09:00', 'Europe/Lisbon')).toBe(
      '2026-10-15T08:00:00.000Z',
    )
    expect(siteLocalToIso('2026-13-45T99:99')).toBeNull()
    expect(siteLocalToIso('ontem')).toBeNull()
    expect(isoToSiteLocal('2026-10-15T12:00:00.000Z')).toBe('2026-10-15T09:00')
    expect(isoToSiteLocal('2026-10-15T12:00:00.000Z', 'UTC')).toBe(
      '2026-10-15T12:00',
    )
    expect(isoToSiteLocal('nope')).toBe('')
  })
})

describe('feeds', () => {
  const channel: FeedChannel = {
    title: 'Clínica & Cia',
    description: 'Blog <da> clínica',
    link: 'https://x.com/blog',
    feedUrl: 'https://x.com/feed.xml',
    updatedAt: '2026-10-15T12:00:00.000Z',
    entries: [
      {
        title: 'Post "um"',
        url: 'https://x.com/blog/um',
        id: 'https://x.com/blog/um',
        publishedAt: '2026-10-14T12:00:00.000Z',
        updatedAt: '2026-10-15T12:00:00.000Z',
        summary: "Resumo d'ele\u0001",
        contentHtml: '<p>a ]]> b</p>',
        categories: ['Dicas'],
        author: 'Ana',
        imageUrl: 'https://x.com/a.png',
      },
      {
        title: 'Dois',
        url: 'https://x.com/blog/dois',
        id: 'https://x.com/blog/dois',
        publishedAt: '2026-10-13T12:00:00.000Z',
        updatedAt: '2026-10-13T12:00:00.000Z',
        summary: '',
        contentHtml: '',
        categories: [],
      },
    ],
  }

  it('escapes XML and drops control characters', () => {
    expect(escapeXml('a&<>"\'\u0001\tb')).toBe('a&amp;&lt;&gt;&quot;&apos;\tb')
  })

  it('renders RSS 2.0', () => {
    const xml = renderRss(channel)
    expect(xml).toContain('<title>Clínica &amp; Cia</title>')
    expect(xml).toContain('<description>Blog &lt;da&gt; clínica</description>')
    expect(xml).toContain(
      '<guid isPermaLink="true">https://x.com/blog/um</guid>',
    )
    expect(xml).toContain(
      '<dc:creator>Ana</dc:creator><category>Dicas</category>',
    )
    expect(xml).toContain('<![CDATA[<p>a ]]]]><![CDATA[> b</p>]]>')
    expect(xml).toContain('<enclosure url="https://x.com/a.png"')
    expect(xml).toContain('<description>Resumo d&apos;ele</description>')
    expect(xml).toContain('rel="self" type="application/rss+xml"')
  })

  it('renders Atom', () => {
    const xml = renderAtom(channel)
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom"')
    expect(xml).toContain(
      '<author><name>Ana</name></author><category term="Dicas"/>',
    )
    expect(xml).toContain(
      '<content type="html">&lt;p&gt;a ]]&gt; b&lt;/p&gt;</content>',
    )
    expect(xml).toContain('<id>https://x.com/feed.xml</id>')
  })

  it('caps the entries', () => {
    const many = {
      ...channel,
      entries: Array.from({ length: FEED_LIMIT + 5 }, () => channel.entries[1]),
    }
    expect(renderRss(many).match(/<item>/g)).toHaveLength(FEED_LIMIT)
    expect(renderAtom(many).match(/<entry>/g)).toHaveLength(FEED_LIMIT)
  })
})

describe('post JSON-LD and llms sections', () => {
  it('builds a BlogPosting and a FAQPage', () => {
    const [posting, faq] = postJsonLd({
      url: 'https://x.com/blog/a',
      siteUrl: 'https://x.com/',
      headline: 'T'.repeat(200),
      description: 'Desc',
      imageUrl: 'https://x.com/a.png',
      publishedAt: '2026-10-14T00:00:00.000Z',
      updatedAt: '2026-10-15T00:00:00.000Z',
      wordCount: 300,
      author: { name: 'Ana', url: 'https://x.com/blog/autor/ana' },
      keywords: ['seo', 'blog', 'seo'],
      section: 'Dicas',
      focusKeyword: 'blog',
      faq: [{ question: 'Q?', answer: 'A.' }],
    })
    expect(posting).toMatchObject({
      '@type': 'BlogPosting',
      headline: 'T'.repeat(110),
      image: ['https://x.com/a.png'],
      author: { '@type': 'Person', name: 'Ana' },
      keywords: 'blog, seo',
      articleSection: 'Dicas',
    })
    expect(faq).toMatchObject({
      '@type': 'FAQPage',
      mainEntity: [{ name: 'Q?', acceptedAnswer: { text: 'A.' } }],
    })
  })

  it('falls back to the organization as author', () => {
    const nodes = postJsonLd({
      url: 'https://x.com/blog/a',
      siteUrl: 'https://x.com/',
      headline: 'T',
      publishedAt: '2026-10-14T00:00:00.000Z',
      updatedAt: '2026-10-15T00:00:00.000Z',
      wordCount: 0,
      keywords: [],
      faq: [],
    })
    expect(nodes).toHaveLength(1)
    expect(nodes[0].author).toEqual({ '@id': 'https://x.com/#organization' })
    expect(nodes[0]).not.toHaveProperty('keywords')
  })

  it('appends graph nodes', () => {
    expect(withGraphNodes({ '@graph': [{ a: 1 }] }, [{ b: 2 }])).toEqual({
      '@graph': [{ a: 1 }, { b: 2 }],
    })
    expect(withGraphNodes({}, [{ b: 2 }])).toEqual({ '@graph': [{ b: 2 }] })
  })

  it('renders llms.txt sections', () => {
    expect(
      renderLlmsSections([
        {
          title: 'Blog',
          links: [
            { title: 'A [x]', url: 'https://x.com/a', summary: 'linha\nnova' },
            { title: 'B', url: 'https://x.com/b' },
          ],
        },
        { title: 'Vazia', links: [] },
      ]),
    ).toBe(
      '## Blog\n\n- [A x](https://x.com/a): linha nova\n- [B](https://x.com/b)',
    )
  })
})

describe('templates', () => {
  it('builds valid default documents for every blog template', () => {
    for (const key of BLOG_TEMPLATE_KEYS) {
      const checked = validateSiteDocument(defaultBlogTemplate(key))
      expect(checked.ok, key).toBe(true)
    }
  })

  it('builds a valid collection item template', () => {
    const doc = defaultCollectionTemplate([
      { key: 'foto', label: 'Foto', type: 'image' },
      { key: 'texto', label: 'Texto', type: 'richtext' },
      { key: 'local', label: 'Local', type: 'text' },
    ])
    expect(validateSiteDocument(doc).ok).toBe(true)
    const fields = Object.values(doc.nodes)
      .filter((node) => node.type === 'site.collection-field')
      .map((node) => [node.props.fieldKey, node.props.label])
    expect(fields).toEqual([
      ['title', ''],
      ['foto', ''],
      ['texto', ''],
      ['local', 'Local:'],
    ])
    expect(validateSiteDocument(defaultCollectionTemplate([])).ok).toBe(true)
  })

  it('names template keys', () => {
    expect(isBlogTemplateKey('blog-post')).toBe(true)
    expect(isBlogTemplateKey('collection:x')).toBe(false)
    expect(collectionTemplateKey('c1')).toBe('collection:c1')
    expect(collectionIdOfTemplate('collection:c1')).toBe('c1')
    expect(collectionIdOfTemplate('collection:')).toBeNull()
    expect(collectionIdOfTemplate('blog-post')).toBeNull()
    expect(isTemplateKey('collection:c1')).toBe(true)
    expect(isTemplateKey('header')).toBe(false)
    expect(templateLabel('blog-post')).toBe('Modelo: Post')
    expect(templateLabel('collection:c1', () => 'Vagas')).toBe(
      'Modelo: item de Vagas',
    )
    expect(templateLabel('collection:c1')).toBe('Modelo: item da coleção')
  })

  it('picks the snapshot template, its fallback or the default', () => {
    const own = defaultBlogTemplate('blog-tag')
    const index = defaultBlogTemplate('blog-index')
    const item = defaultCollectionTemplate([])
    const snapshot = createFakeSnapshot({
      globals: [
        { id: 'g1', kind: 'TEMPLATE', name: 'blog-tag', document: own },
        { id: 'g2', kind: 'TEMPLATE', name: 'blog-index', document: index },
        { id: 'g3', kind: 'TEMPLATE', name: 'collection:c1', document: item },
        { id: 'g4', kind: 'HEADER', name: 'Cabeçalho', document: own },
      ],
    })
    expect(snapshotTemplateKeys(snapshot)).toEqual(
      new Set(['blog-tag', 'blog-index', 'collection:c1']),
    )
    expect(templateDocument(snapshot, 'blog-tag')).toBe(own)
    expect(templateDocument(snapshot, 'blog-category')).toBe(index)
    expect(templateDocument(snapshot, 'collection:c1')).toBe(item)
    expect(templateDocument(snapshot, 'collection:c2')).toBeNull()
    const bare = createFakeSnapshot({ globals: [] })
    expect(templateDocument(bare, 'blog-post')).toEqual(
      defaultBlogTemplate('blog-post'),
    )
    expect(templateDocument(bare, 'blog-author')).toEqual(
      defaultBlogTemplate('blog-author'),
    )
  })

  it('shapes virtual pages', () => {
    const doc = defaultBlogTemplate('blog-post')
    expect(
      virtualPage({ id: 'post:1', title: 'T', path: 'blog/t', document: doc }),
    ).toEqual({
      id: 'post:1',
      parentId: null,
      title: 'T',
      slug: 't',
      path: 'blog/t',
      position: 0,
      isHome: false,
      seo: {},
      document: doc,
    })
  })

  it('provides a sample blog', () => {
    const blog = sampleBlogData(new Date('2026-10-15T00:00:00Z'))
    expect(blog.posts).toHaveLength(6)
    expect(blog.posts[0].featured).toBe(true)
    expect(blog.posts[1].publishedAt).toBe('2026-10-12T00:00:00.000Z')
    expect(sampleBlogData().authors).toHaveLength(1)
    expect(samplePostBody().html).toContain('<h2')
  })
})

describe('withLlmsSections', () => {
  const sections = [
    { title: 'Blog', links: [{ title: 'A', url: 'https://x.com/a' }] },
  ]
  it('inserts before the optional links or appends', () => {
    expect(withLlmsSections('# Site\n\n## Opcional\n\n- x\n', sections)).toBe(
      '# Site\n\n## Blog\n\n- [A](https://x.com/a)\n\n## Opcional\n\n- x\n',
    )
    expect(withLlmsSections('# Site\n', sections)).toBe(
      '# Site\n\n## Blog\n\n- [A](https://x.com/a)\n',
    )
    expect(withLlmsSections('# Site\n', [])).toBe('# Site\n')
  })
})

describe('post analysis', () => {
  it('maps a post to a canvas document for the Buscadores checks', () => {
    const doc = postSearchDocument('Título', [
      { type: 'h1', children: [{ text: 'Seção' }] },
      { type: 'h2', children: [{ text: '' }] },
      { type: 'p', children: [{ text: 'Texto <b>' }] },
      { type: 'p', children: [{ text: ' ' }] },
      { type: 'p', listStyleType: 'decimal', children: [{ text: 'Um' }] },
      { type: 'p', listStyleType: 'disc', children: [{ text: '' }] },
      { type: 'img', url: '/media/a.png', alt: 'A', children: [] },
      { type: 'img', url: '/media/b.png', children: [] },
      { type: 'img', url: 'javascript:x', children: [] },
    ])
    const nodes = Object.values(doc.nodes)
    expect(
      nodes
        .filter((n) => n.type === 'site.heading')
        .map((n) => [n.props.level, n.props.text]),
    ).toEqual([
      ['h1', 'Título'],
      ['h2', 'Seção'],
    ])
    expect(
      nodes.filter((n) => n.type === 'site.text').map((n) => n.props.html),
    ).toEqual(['<p>Texto &lt;b&gt;</p>', '<ol><li>Um</li></ol>'])
    expect(nodes.filter((n) => n.type === 'site.image')).toHaveLength(2)
    expect(validateSiteDocument(doc).ok).toBe(true)
    expect(
      Object.values(postSearchDocument('', 'x').nodes).some(
        (n) => n.props.text === 'Sem título',
      ),
    ).toBe(true)
  })

  it('scores a post like a page', () => {
    const analysis = analyzePost({
      post: {
        id: 'p',
        title: 'Plano',
        slug: '',
        seo: { search: { focusKeyword: 'plano' } },
        content: [],
      },
      site: {
        name: 'Site',
        settings: createFakeSnapshot().settings,
        url: 'https://x.com',
      },
      now: new Date('2026-10-15T00:00:00Z'),
    })
    expect(analysis.seo.score).toBeGreaterThanOrEqual(0)
    expect(analysis.aeo.checks.length).toBeGreaterThan(0)
    expect(
      analyzePost({
        post: { id: 'p', title: 'Plano', slug: 'plano', seo: {}, content: [] },
        site: {
          name: 'Site',
          settings: createFakeSnapshot().settings,
          url: 'https://x.com',
        },
        siblings: [],
      }).geo.score,
    ).toBeGreaterThanOrEqual(0)
  })
})
