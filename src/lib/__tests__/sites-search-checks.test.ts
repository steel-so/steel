import { describe, expect, it } from 'vitest'
import {
  searchDocument,
  searchInput,
  searchSettings,
  words,
} from '@/src/__tests__/factories/site-search.factory'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import {
  heading,
  image,
  list,
  type NodeSpec,
  spec,
  text,
} from '@/src/lib/canvas-site/presets/builder'
import {
  analyzeSearchPage,
  buildSearchReport,
  checkImpact,
  SCORE_BAND_LABELS,
  scoreBand,
  scoreChecks,
} from '@/src/lib/sites/search/analyze'
import {
  buildCheckContext,
  renderedTitle,
  resolveBusinessProfile,
} from '@/src/lib/sites/search/context'
import { isAuthoritative } from '@/src/lib/sites/search/geo-checks'
import type {
  SearchCheck,
  SearchPageAnalysis,
  SearchPageInput,
} from '@/src/lib/sites/search/types'
import type { SitePageSeoDTO } from '@/src/schemas/site-page.schema'
import type {
  SearchContentDTO,
  SiteBusinessProfileDTO,
} from '@/src/schemas/site-search.schema'

const KEYWORD = 'implante dentário'

/** A paragraph of `n` words that mentions the keyword once and a fact. */
function paragraph(n: number, extra = ''): string {
  return `<p>O implante dentário dura 20 anos. ${extra}${words(Math.max(0, n - 6))}</p>`
}

/** A page that passes almost everything. */
function goodChildren(): NodeSpec[] {
  return [
    heading('h1', 'Implante dentário em São Paulo'),
    text(paragraph(40, 'Atendemos 300 pacientes desde 2010 com garantia. ')),
    heading('h2', 'Quanto custa um implante?'),
    text(paragraph(45)),
    heading('h2', 'Como funciona o tratamento?'),
    text(paragraph(50)),
    heading('h3', 'Qual o prazo de recuperação?'),
    text(paragraph(48)),
    list(['Avaliação', 'Cirurgia', 'Prótese']),
    image('/media/implante.png', 'Implante dentário'),
    text(
      `<p>Veja a <a href="https://www.gov.br/saude">orientação oficial</a> e <a href="/precos">nossos preços</a>. ${words(150)}</p>`,
    ),
    spec(SITE_TYPES.accordion, {}, [
      spec(SITE_TYPES.accordionItem, { title: 'Dói?' }, [text(paragraph(42))]),
    ]),
  ]
}

const GOOD_PROFILE: SiteBusinessProfileDTO = {
  type: 'Dentist',
  name: 'Clínica Sorriso',
  description: 'Clínica odontológica.',
  category: 'Odontologia',
  phone: '(11) 3333-4444',
  address: { street: 'Rua A, 1', city: 'São Paulo' },
  logoUrl: '/logo.png',
  sameAs: ['https://instagram.com/sorriso'],
  hours: [{ days: ['Monday'], opens: '08:00', closes: '18:00' }],
  foundingYear: 2010,
}

const GOOD_SEARCH: SearchContentDTO = {
  focusKeyword: KEYWORD,
  synonyms: ['implantes dentários'],
  questions: [
    { question: 'Dói?', answer: words(45) },
    { question: 'Quanto tempo?', answer: words(50) },
    { question: 'Tem garantia?', answer: words(42) },
  ],
  summary: words(30),
  speakable: true,
  showUpdatedDate: true,
  structuredData: [
    {
      type: 'Service',
      name: 'Implante',
      description: 'D',
      serviceType: 'Odonto',
    },
  ],
}

function goodInput(
  overrides: {
    children?: NodeSpec[]
    seo?: Partial<SitePageSeoDTO>
    search?: Partial<SearchContentDTO>
    profile?: SiteBusinessProfileDTO
    crawlers?: Record<string, boolean>
    llms?: boolean
  } & Omit<Parameters<typeof searchInput>[0] & object, 'seo' | 'document'> = {},
): SearchPageInput {
  const { children, seo, search, profile, crawlers, llms, ...rest } = overrides
  return searchInput({
    updatedAt: '2026-10-01T00:00:00.000Z',
    chromeText: 'Ligue (11) 3333-4444',
    ...rest,
    document: searchDocument(...(children ?? goodChildren())),
    seo: {
      title: 'Implante dentário em SP com garantia e preço justo',
      description:
        `Implante dentário com especialistas em São Paulo. ${'Avaliação gratuita e parcelamento. '.repeat(3)}`.slice(
          0,
          150,
        ),
      socialImageUrl: '/og.png',
      search: { ...GOOD_SEARCH, ...search },
      ...seo,
    },
    settings:
      rest.settings ??
      searchSettings({
        search: {
          business: profile ?? GOOD_PROFILE,
          crawlers: crawlers ?? {},
          llms: { enabled: llms ?? true },
          indexNow: { enabled: false },
          verification: {},
        },
      }),
  })
}

function find(analysis: SearchPageAnalysis, id: string): SearchCheck {
  const pillar = id.split('.')[0] as keyof SearchPageAnalysis
  const found = analysis[pillar].checks.find((item) => item.id === id)
  if (!found) throw new Error(`check ${id} not found`)
  return found
}

function status(input: SearchPageInput, id: string) {
  return find(analyzeSearchPage(input), id).status
}

describe('analyzeSearchPage — a well-built page', () => {
  it('scores high in the three pillars', () => {
    const analysis = analyzeSearchPage(goodInput())
    const failing = Object.values(analysis)
      .flatMap((pillar) => pillar.checks)
      .filter((item) => item.status !== 'pass')
      .map((item) => `${item.id}: ${item.message}`)
    expect(failing).toEqual([])
    expect(analysis.seo.score).toBe(100)
    expect(analysis.aeo.score).toBe(100)
    expect(analysis.geo.score).toBe(100)
    expect(analysis.seo.checks.every((item) => item.pillar === 'seo')).toBe(
      true,
    )
  })
})

describe('SEO checks', () => {
  it('requires a focus keyword and drops the keyword checks without one', () => {
    const analysis = analyzeSearchPage(
      goodInput({ search: { focusKeyword: undefined, synonyms: undefined } }),
    )
    const keyword = find(analysis, 'seo.keyword')
    expect(keyword).toMatchObject({
      status: 'fail',
      weight: 6,
      fix: { kind: 'open', target: 'keyword' },
    })
    expect(
      analysis.seo.checks.some((item) => item.id === 'seo.title-keyword'),
    ).toBe(false)
    expect(
      analysis.seo.checks.some((item) => item.id === 'seo.keyword-usage'),
    ).toBe(false)
    expect(
      find(
        analyzeSearchPage(goodInput({ search: { synonyms: [] } })),
        'seo.keyword',
      ).message,
    ).toContain('Variações')
  })

  it('grades the title length', () => {
    expect(
      status(
        goodInput({ seo: { title: 'Implante dentário SP' } }),
        'seo.title-length',
      ),
    ).toBe('warn')
    expect(
      status(goodInput({ seo: { title: 'Implante' } }), 'seo.title-length'),
    ).toBe('fail')
    expect(
      status(
        goodInput({ seo: { title: `Implante dentário ${'x'.repeat(48)}` } }),
        'seo.title-length',
      ),
    ).toBe('warn')
    const long = find(
      analyzeSearchPage(
        goodInput({ seo: { title: `Implante dentário ${'x'.repeat(60)}` } }),
      ),
      'seo.title-length',
    )
    expect(long).toMatchObject({
      status: 'fail',
      fix: { kind: 'ai', field: 'title' },
    })
    // The site template counts.
    const templated = goodInput({
      seo: { title: 'Implante dentário em São Paulo' },
    })
    templated.site.settings = {
      ...templated.site.settings,
      seo: { titleTemplate: '%s | Clínica Sorriso Odontologia Avançada' },
    }
    expect(status(templated, 'seo.title-length')).toBe('warn')
  })

  it('checks the keyword in title, description and H1', () => {
    const analysis = analyzeSearchPage(
      goodInput({
        seo: {
          title: 'Clínica de dentes em São Paulo com garantia',
          description: 'Sem o termo. '.repeat(10),
        },
        children: [heading('h1', 'Bem-vindo'), ...goodChildren().slice(1)],
      }),
    )
    expect(find(analysis, 'seo.title-keyword')).toMatchObject({
      status: 'warn',
      fix: { kind: 'ai', field: 'title' },
    })
    expect(find(analysis, 'seo.description-keyword')).toMatchObject({
      status: 'warn',
      fix: { field: 'description' },
    })
    expect(find(analysis, 'seo.h1-keyword')).toMatchObject({
      status: 'warn',
      fix: { kind: 'select' },
    })
    // Synonyms count as the keyword.
    expect(
      status(
        goodInput({
          seo: { title: 'Implantes dentários em São Paulo com garantia' },
        }),
        'seo.title-keyword',
      ),
    ).toBe('pass')
  })

  it('grades the description and offers the first paragraph', () => {
    const empty = find(
      analyzeSearchPage(goodInput({ seo: { description: undefined } })),
      'seo.description',
    )
    expect(empty.status).toBe('fail')
    expect(empty.fix).toMatchObject({
      kind: 'patch',
      set: { description: expect.stringContaining('implante dentário') },
    })
    const noText = find(
      analyzeSearchPage(
        goodInput({
          seo: { description: undefined },
          children: [heading('h1', 'Só título')],
        }),
      ),
      'seo.description',
    )
    expect(noText.fix).toMatchObject({ kind: 'ai', field: 'description' })
    expect(
      status(
        goodInput({ seo: { description: 'x'.repeat(90) } }),
        'seo.description',
      ),
    ).toBe('warn')
    expect(
      status(
        goodInput({ seo: { description: 'x'.repeat(180) } }),
        'seo.description',
      ),
    ).toBe('warn')
    expect(
      status(
        goodInput({ seo: { description: 'x'.repeat(40) } }),
        'seo.description',
      ),
    ).toBe('fail')
    expect(
      status(
        goodInput({ seo: { description: 'x'.repeat(260) } }),
        'seo.description',
      ),
    ).toBe('fail')
    // The site default counts as the description.
    const fallback = goodInput({ seo: { description: undefined } })
    fallback.site.settings = {
      ...fallback.site.settings,
      seo: { description: `Implante dentário ${'y'.repeat(120)}` },
    }
    expect(status(fallback, 'seo.description')).toBe('pass')
  })

  it('checks the slug', () => {
    expect(
      find(
        analyzeSearchPage(goodInput({ isHome: true, slug: 'inicio' })),
        'seo.slug',
      ).message,
    ).toContain('raiz')
    expect(
      status(
        goodInput({ slug: 'um-endereco-muito-longo-com-palavras-demais-aqui' }),
        'seo.slug',
      ),
    ).toBe('warn')
    expect(status(goodInput({ slug: 'servicos' }), 'seo.slug')).toBe('warn')
    expect(status(goodInput({ slug: 'implantes-dentarios' }), 'seo.slug')).toBe(
      'pass',
    )
    expect(
      status(
        goodInput({ slug: 'servicos', search: { focusKeyword: '!!!' } }),
        'seo.slug',
      ),
    ).toBe('pass')
  })

  it('requires exactly one H1 and offers canvas fixes', () => {
    const none = find(
      analyzeSearchPage(
        goodInput({ children: [heading('h2', 'Seção'), text(paragraph(40))] }),
      ),
      'seo.h1',
    )
    expect(none.status).toBe('fail')
    expect(none.fix).toMatchObject({
      kind: 'canvas',
      ops: [{ kind: 'update', set: { level: 'h1' } }],
    })
    const noHeading = find(
      analyzeSearchPage(goodInput({ children: [text(paragraph(40))] })),
      'seo.h1',
    )
    expect(noHeading.fix).toBeUndefined()
    const many = find(
      analyzeSearchPage(
        goodInput({
          children: [
            heading('h1', 'A'),
            heading('h1', 'B'),
            heading('h1', 'C'),
          ],
        }),
      ),
      'seo.h1',
    )
    expect(many.fix).toMatchObject({
      kind: 'canvas',
      ops: [{ set: { level: 'h2' } }, { set: { level: 'h2' } }],
    })
  })

  it('flags skipped heading levels', () => {
    const skipped = find(
      analyzeSearchPage(
        goodInput({ children: [heading('h1', 'A'), heading('h4', 'Pulou')] }),
      ),
      'seo.heading-order',
    )
    expect(skipped).toMatchObject({ status: 'warn', fix: { kind: 'select' } })
    expect(skipped.message).toContain('H4 logo depois de um H1')
  })

  it('measures image alt coverage', () => {
    const without = [heading('h1', 'A')]
    expect(
      find(analyzeSearchPage(goodInput({ children: without })), 'seo.image-alt')
        .message,
    ).toContain('não tem imagens')
    const images = (missing: number, total: number) =>
      Array.from({ length: total }, (_, index) =>
        image(`/i${index}.png`, index < missing ? '' : 'Foto'),
      )
    expect(status(goodInput({ children: images(1, 6) }), 'seo.image-alt')).toBe(
      'warn',
    )
    expect(
      find(
        analyzeSearchPage(goodInput({ children: images(2, 3) })),
        'seo.image-alt',
      ),
    ).toMatchObject({
      status: 'fail',
      fix: { kind: 'select' },
    })
  })

  it('counts internal and external links', () => {
    const analysis = analyzeSearchPage(
      goodInput({ children: [heading('h1', 'A'), text(paragraph(20))] }),
    )
    expect(find(analysis, 'seo.internal-links').status).toBe('warn')
    expect(find(analysis, 'seo.external-links').status).toBe('warn')
  })

  it('grades the amount of text', () => {
    expect(
      status(
        goodInput({ children: [heading('h1', 'A'), text(paragraph(200))] }),
        'seo.word-count',
      ),
    ).toBe('warn')
    expect(
      status(
        goodInput({ children: [heading('h1', 'A'), text(paragraph(50))] }),
        'seo.word-count',
      ),
    ).toBe('fail')
  })

  it('checks keyword usage in the content', () => {
    expect(
      status(
        goodInput({
          children: [heading('h1', 'A'), text(`<p>${words(80)}</p>`)],
        }),
        'seo.keyword-usage',
      ),
    ).toBe('fail')
    expect(
      status(
        goodInput({
          children: [
            heading('h1', 'A'),
            text(
              '<p>Implante dentário implante dentário implante dentário.</p>',
            ),
          ],
        }),
        'seo.keyword-usage',
      ),
    ).toBe('warn')
    const late = [
      heading('h1', 'A'),
      text(`<p>${words(60)}</p>`),
      text(`<p>${words(60)}</p>`),
      text(paragraph(60)),
    ]
    expect(
      find(
        analyzeSearchPage(goodInput({ children: late })),
        'seo.keyword-usage',
      ).message,
    ).toContain('primeiro parágrafo')
    expect(status(goodInput({ children: [] }), 'seo.keyword-usage')).toBe(
      'fail',
    )
  })

  it('finds duplicate titles and descriptions across the site', () => {
    const input = goodInput()
    input.siblings = [
      { id: 'p2', title: 'Outra', seo: { title: input.page.seo.title } },
    ]
    expect(find(analyzeSearchPage(input), 'seo.unique')).toMatchObject({
      status: 'fail',
      fix: { field: 'title' },
    })
    input.siblings = [
      {
        id: 'p2',
        title: 'Outra',
        seo: { description: input.page.seo.description },
      },
    ]
    expect(find(analyzeSearchPage(input), 'seo.unique')).toMatchObject({
      status: 'warn',
      fix: { field: 'description' },
    })
    const noDescription = goodInput({ seo: { description: undefined } })
    noDescription.siblings = [{ id: 'p2', title: 'Outra', seo: {} }]
    expect(status(noDescription, 'seo.unique')).toBe('pass')
  })

  it('checks indexing, canonical and the social image', () => {
    const siteHidden = goodInput()
    siteHidden.site.settings = {
      ...siteHidden.site.settings,
      seo: { noindex: true },
    }
    expect(
      find(analyzeSearchPage(siteHidden), 'seo.indexable').message,
    ).toContain('site inteiro')
    expect(
      find(
        analyzeSearchPage(goodInput({ seo: { noindex: true } })),
        'seo.indexable',
      ).fix,
    ).toMatchObject({ target: 'page-settings' })
    expect(
      status(
        goodInput({ seo: { canonicalUrl: 'https://outro.com/x' } }),
        'seo.canonical',
      ),
    ).toBe('warn')
    expect(
      status(
        goodInput({
          seo: { canonicalUrl: 'https://clinica.sites.test/implante-dentario' },
        }),
        'seo.canonical',
      ),
    ).toBe('pass')
    expect(
      status(goodInput({ seo: { socialImageUrl: undefined } }), 'seo.social'),
    ).toBe('warn')
  })
})

describe('AEO checks', () => {
  it('counts question headings', () => {
    expect(
      status(
        goodInput({
          children: [heading('h1', 'A'), heading('h2', 'Como agendar?')],
        }),
        'aeo.question-headings',
      ),
    ).toBe('warn')
    expect(
      find(
        analyzeSearchPage(goodInput({ children: [heading('h1', 'A')] })),
        'aeo.question-headings',
      ),
    ).toMatchObject({
      status: 'fail',
      fix: { target: 'questions' },
    })
  })

  it('grades the direct answers after questions', () => {
    const none = goodInput({
      children: [heading('h1', 'A')],
      search: { questions: [] },
    })
    expect(find(analyzeSearchPage(none), 'aeo.direct-answers')).toMatchObject({
      status: 'warn',
      fix: { target: 'questions' },
    })
    const half = goodInput({
      children: [heading('h2', 'Quanto custa?'), text(`<p>${words(30)}</p>`)],
      search: { questions: [] },
    })
    expect(find(analyzeSearchPage(half), 'aeo.direct-answers')).toMatchObject({
      status: 'warn',
      fix: { kind: 'ai', field: 'answers' },
    })
    const bad = goodInput({
      children: [
        heading('h2', 'Quanto custa?'),
        heading('h2', 'Outro?'),
        text(`<p>${words(5)}</p>`),
      ],
      search: { questions: [{ question: 'Q?', answer: '' }] },
    })
    expect(status(bad, 'aeo.direct-answers')).toBe('fail')
  })

  it('wants a visible FAQ and offers to insert the registered questions', () => {
    const noAccordion = goodChildren().slice(0, -1)
    expect(
      find(analyzeSearchPage(goodInput({ children: noAccordion })), 'aeo.faq')
        .fix,
    ).toMatchObject({ kind: 'insert-faq' })
    expect(
      find(
        analyzeSearchPage(
          goodInput({ children: noAccordion, search: { questions: [] } }),
        ),
        'aeo.faq',
      ).fix,
    ).toMatchObject({ kind: 'open', target: 'questions' })
  })

  it('grades the registered questions', () => {
    expect(
      status(
        goodInput({
          search: { questions: [{ question: 'A?', answer: 'Sim' }] },
        }),
        'aeo.questions',
      ),
    ).toBe('warn')
    expect(
      status(goodInput({ search: { questions: undefined } }), 'aeo.questions'),
    ).toBe('fail')
  })

  it('checks lists and tables', () => {
    expect(
      status(goodInput({ children: [heading('h1', 'A')] }), 'aeo.lists'),
    ).toBe('warn')
    expect(
      status(
        goodInput({ children: [spec(SITE_TYPES.pricing, { items: [] })] }),
        'aeo.lists',
      ),
    ).toBe('pass')
  })

  it('suggests HowTo for step-by-step content', () => {
    const steps = [
      heading('h1', 'Como escovar os dentes'),
      list(['Um', 'Dois'], { marker: 'number' }),
    ]
    expect(
      find(analyzeSearchPage(goodInput({ children: steps })), 'aeo.howto'),
    ).toMatchObject({
      status: 'warn',
      fix: { target: 'structured' },
    })
    expect(
      status(
        goodInput({ children: [heading('h2', 'Passo 1: avaliar')] }),
        'aeo.howto',
      ),
    ).toBe('warn')
    expect(
      status(
        goodInput({
          children: steps,
          search: { structuredData: [{ type: 'HowTo' }] },
        }),
        'aeo.howto',
      ),
    ).toBe('pass')
    expect(
      find(
        analyzeSearchPage(goodInput({ children: [heading('h1', 'Sobre')] })),
        'aeo.howto',
      ).message,
    ).toContain('Não se aplica')
  })

  it('grades the speakable summary', () => {
    expect(
      find(
        analyzeSearchPage(goodInput({ search: { summary: undefined } })),
        'aeo.speakable',
      ).status,
    ).toBe('fail')
    expect(
      status(goodInput({ search: { summary: words(5) } }), 'aeo.speakable'),
    ).toBe('warn')
    expect(
      status(goodInput({ search: { summary: words(70) } }), 'aeo.speakable'),
    ).toBe('warn')
    expect(
      find(
        analyzeSearchPage(goodInput({ search: { speakable: false } })),
        'aeo.speakable',
      ).fix,
    ).toEqual({
      kind: 'patch',
      label: 'Marcar como falável',
      set: { search: { speakable: true } },
    })
  })

  it('grades paragraph length', () => {
    expect(
      status(goodInput({ children: [heading('h1', 'A')] }), 'aeo.concise'),
    ).toBe('warn')
    expect(
      status(goodInput({ children: [text(paragraph(100))] }), 'aeo.concise'),
    ).toBe('warn')
    expect(
      status(goodInput({ children: [text(paragraph(140))] }), 'aeo.concise'),
    ).toBe('fail')
  })
})

describe('GEO checks', () => {
  it('grades the business profile', () => {
    expect(
      status(
        goodInput({
          profile: {
            name: 'X',
            description: 'D',
            phone: '1',
            address: { city: 'C', street: 'S' },
          },
        }),
        'geo.entity',
      ),
    ).toBe('warn')
    expect(
      find(analyzeSearchPage(goodInput({ profile: {} })), 'geo.entity'),
    ).toMatchObject({
      status: 'fail',
      fix: { target: 'business' },
    })
  })

  it('checks NAP consistency', () => {
    expect(
      status(goodInput({ chromeText: 'Ligue (11) 2222-1111' }), 'geo.nap'),
    ).toBe('fail')
    expect(status(goodInput({ chromeText: '' }), 'geo.nap')).toBe('warn')
    expect(
      find(
        analyzeSearchPage(
          goodInput({ profile: { ...GOOD_PROFILE, phone: undefined } }),
        ),
        'geo.nap',
      ).fix,
    ).toMatchObject({
      target: 'business',
    })
    const noChrome = goodInput()
    noChrome.chromeText = undefined
    expect(status(noChrome, 'geo.nap')).toBe('warn')
  })

  it('counts factual sentences', () => {
    expect(
      status(
        goodInput({ children: [text(`<p>${words(20)}</p>`)] }),
        'geo.facts',
      ),
    ).toBe('fail')
    expect(
      status(
        goodInput({ children: [text('<p>Desde 2010. Sem números aqui.</p>')] }),
        'geo.facts',
      ),
    ).toBe('warn')
  })

  it('wants a quotable summary at the top', () => {
    const longFirst = [heading('h1', 'A'), text(paragraph(120))]
    expect(
      find(
        analyzeSearchPage(goodInput({ children: longFirst })),
        'geo.summary-top',
      ).fix,
    ).toMatchObject({
      kind: 'insert-summary',
    })
    expect(
      find(
        analyzeSearchPage(
          goodInput({ children: longFirst, search: { summary: undefined } }),
        ),
        'geo.summary-top',
      ),
    ).toMatchObject({ status: 'fail', fix: { target: 'summary' } })
  })

  it('rates sources by authority', () => {
    expect(isAuthoritative('https://www.gov.br/saude')).toBe(true)
    expect(isAuthoritative('https://pt.wikipedia.org/wiki/Implante')).toBe(true)
    expect(isAuthoritative('https://blog.exemplo.com')).toBe(false)
    expect(isAuthoritative('/interno')).toBe(false)
    const external = [
      heading('h1', 'A'),
      text('<p><a href="https://blog.exemplo.com">blog</a></p>'),
    ]
    expect(status(goodInput({ children: external }), 'geo.citations')).toBe(
      'warn',
    )
    expect(
      status(goodInput({ children: [heading('h1', 'A')] }), 'geo.citations'),
    ).toBe('fail')
  })

  it('grades freshness and the visible date', () => {
    const at = (updatedAt?: string) => goodInput({ updatedAt })
    expect(status(at(undefined), 'geo.freshness')).toBe('warn')
    expect(
      find(analyzeSearchPage(at('2026-10-15T08:00:00Z')), 'geo.freshness')
        .message,
    ).toContain('hoje')
    expect(
      find(analyzeSearchPage(at('2026-10-14T08:00:00Z')), 'geo.freshness')
        .message,
    ).toContain('ontem')
    expect(status(at('2026-01-01T00:00:00Z'), 'geo.freshness')).toBe('warn')
    expect(status(at('2024-01-01T00:00:00Z'), 'geo.freshness')).toBe('fail')
    expect(
      find(
        analyzeSearchPage(goodInput({ search: { showUpdatedDate: false } })),
        'geo.freshness',
      ).fix,
    ).toMatchObject({
      kind: 'patch',
      set: { search: { showUpdatedDate: true } },
    })
  })

  it('validates the structured data items', () => {
    expect(
      find(
        analyzeSearchPage(
          goodInput({ search: { structuredData: [{ type: 'Event' }] } }),
        ),
        'geo.structured',
      ),
    ).toMatchObject({
      status: 'fail',
      message: expect.stringContaining('Event: falta'),
    })
    const plain = goodChildren().slice(0, -1)
    expect(
      status(
        goodInput({ children: plain, search: { structuredData: [] } }),
        'geo.structured',
      ),
    ).toBe('warn')
    expect(
      status(goodInput({ search: { structuredData: [] } }), 'geo.structured'),
    ).toBe('pass')
  })

  it('summarizes the semantic HTML problems', () => {
    expect(
      status(
        goodInput({ children: [heading('h1', 'A'), heading('h1', 'B')] }),
        'geo.semantic',
      ),
    ).toBe('warn')
    expect(
      status(
        goodInput({
          children: [
            heading('h2', 'A'),
            heading('h4', 'B'),
            image('/x.png', ''),
          ],
        }),
        'geo.semantic',
      ),
    ).toBe('fail')
  })

  it('checks AI access to the content', () => {
    expect(status(goodInput({ seo: { noindex: true } }), 'geo.ai-access')).toBe(
      'fail',
    )
    expect(
      find(
        analyzeSearchPage(
          goodInput({ crawlers: { PerplexityBot: false, GPTBot: false } }),
        ),
        'geo.ai-access',
      ).message,
    ).toBe(
      'Bloqueados no robots.txt: PerplexityBot. Eles não podem citar o site.',
    )
    expect(
      status(goodInput({ crawlers: { GPTBot: false } }), 'geo.ai-access'),
    ).toBe('pass')
    expect(status(goodInput({ llms: false }), 'geo.ai-access')).toBe('warn')
  })
})

describe('context and scoring', () => {
  it('resolves the business profile with the old SEO fields', () => {
    const settings = searchSettings({
      seo: {
        organizationName: 'Org',
        logoUrl: '/seo-logo.png',
        sameAs: ['https://x.com/o'],
        description: 'Desc',
      },
    })
    expect(resolveBusinessProfile(settings, 'Site')).toEqual({
      name: 'Org',
      logoUrl: '/seo-logo.png',
      sameAs: ['https://x.com/o'],
      description: 'Desc',
    })
    expect(
      resolveBusinessProfile(
        searchSettings({ faviconUrl: '/fav.png' }),
        'Site',
      ),
    ).toEqual({
      name: 'Site',
      logoUrl: '/fav.png',
    })
    expect(
      renderedTitle(
        searchSettings({ seo: { titleTemplate: 'sem placeholder' } }),
        { title: 'T', seo: {} },
      ),
    ).toBe('T')
    const ctx = buildCheckContext(searchInput())
    expect(ctx.keyword).toBeNull()
    expect(ctx.terms).toEqual([])
    expect(ctx.description).toBe('')
  })

  it('scores weights, bands and impact', () => {
    expect(scoreChecks([])).toBe(100)
    expect(
      scoreChecks([
        { status: 'pass', weight: 2 },
        { status: 'warn', weight: 2 },
        { status: 'fail', weight: 1 },
      ]),
    ).toBe(60)
    expect(checkImpact({ status: 'warn', weight: 4 })).toBe(2)
    expect(scoreBand(80)).toBe('good')
    expect(scoreBand(50)).toBe('fair')
    expect(scoreBand(10)).toBe('poor')
    expect(SCORE_BAND_LABELS.poor).toBe('Precisa de atenção')
  })

  it('builds the site report with ranked issues', () => {
    const good = analyzeSearchPage(goodInput())
    const bad = analyzeSearchPage(
      searchInput({ document: searchDocument(heading('h2', 'Seção')) }),
    )
    const worse = analyzeSearchPage(searchInput())
    const report = buildSearchReport(
      [
        { id: 'a', title: 'Boa', path: '/', analysis: good },
        { id: 'b', title: 'Ruim', path: '/ruim', analysis: bad },
        { id: 'c', title: 'Pior', path: '/pior', analysis: worse },
      ],
      5,
    )
    expect(report.pages.map((page) => page.issues)).toEqual([
      0,
      expect.any(Number),
      expect.any(Number),
    ])
    expect(report.pages[0].scores).toEqual({ seo: 100, aeo: 100, geo: 100 })
    expect(report.issues).toHaveLength(5)
    expect(report.issues[0].impact).toBeGreaterThanOrEqual(
      report.issues[1].impact,
    )
    expect(report.issues[0].pages.map((page) => page.id)).toEqual(['b', 'c'])
    expect(report.averages.seo).toBe(
      Math.round((good.seo.score + bad.seo.score + worse.seo.score) / 3),
    )
    expect(buildSearchReport([])).toEqual({
      averages: { seo: 0, aeo: 0, geo: 0 },
      pages: [],
      issues: [],
    })
  })
})
