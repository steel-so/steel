import { describe, expect, it } from 'vitest'
import {
  emailDocument,
  renderEditing,
} from '@/src/__tests__/helpers/email-canvas'
import { createCanvasStore } from '@/src/lib/canvas/store'
import type { CanvasFragment } from '@/src/lib/canvas/types'
import { emailCatalog } from '@/src/lib/canvas-email/catalog'
import {
  emptyPostItem,
  POSTS_BLOCK,
} from '@/src/lib/canvas-email/components/content'
import { createBlankEmailDocument } from '@/src/lib/canvas-email/presets'
import { renderEmailDocument } from '@/src/lib/canvas-email/render'
import { DEFAULT_EMAIL_BRAND } from '@/src/lib/canvas-email/theme'
import {
  normalizeEmailDocument,
  validateEmailDocument,
} from '@/src/lib/canvas-email/validate'
import {
  abDecideAt,
  abRate,
  abShareSize,
  pickAbWinner,
} from '@/src/lib/crm-newsletter/ab-test'
import {
  buildDigestDocument,
  documentText,
  postsSection,
  toPostItems,
} from '@/src/lib/crm-newsletter/digest-document'
import {
  DIGEST_DATE_TOKEN,
  digestCron,
  digestDateLabel,
  digestSubject,
  firstDigestLookbackDays,
  nextDigestRun,
} from '@/src/lib/crm-newsletter/digest-schedule'
import { replaceContentOp } from '@/src/lib/crm-newsletter/replace-content'

const POSTS = [
  {
    title: 'Como escolher um plano',
    excerpt: 'Um guia rápido.',
    url: 'https://acme.sites.steel.app/blog/planos',
    imageUrl: 'https://cdn.acme.com.br/capa.png',
  },
  {
    title: 'Sem imagem',
    excerpt: '',
    url: 'https://acme.sites.steel.app/blog/sem-imagem',
    imageUrl: null,
  },
]

const valid = (doc: unknown) =>
  validateEmailDocument(normalizeEmailDocument(doc))

describe('digest schedule', () => {
  it('builds the cron of each cadence and refuses incomplete ones', () => {
    expect(
      digestCron({ cadence: 'WEEKLY', weekday: 1, monthDay: null, hour: 9 }),
    ).toBe('0 9 * * 1')
    expect(
      digestCron({ cadence: 'MONTHLY', weekday: null, monthDay: 15, hour: 0 }),
    ).toBe('0 0 15 * *')
    expect(
      digestCron({ cadence: 'WEEKLY', weekday: null, monthDay: null, hour: 9 }),
    ).toBeNull()
    expect(
      digestCron({ cadence: 'WEEKLY', weekday: 7, monthDay: null, hour: 9 }),
    ).toBeNull()
    expect(
      digestCron({ cadence: 'MONTHLY', weekday: null, monthDay: 29, hour: 9 }),
    ).toBeNull()
    expect(
      digestCron({ cadence: 'MONTHLY', weekday: null, monthDay: 1, hour: 24 }),
    ).toBeNull()
  })

  it('computes the next run in São Paulo time (UTC-3)', () => {
    // Wednesday 2026-10-28 13:00 UTC = 10:00 in São Paulo.
    const now = new Date('2026-10-28T13:00:00.000Z')
    const weekly = nextDigestRun(
      { cadence: 'WEEKLY', weekday: 1, monthDay: null, hour: 9 },
      now,
    )
    expect(weekly?.toISOString()).toBe('2026-11-02T12:00:00.000Z')
    const monthly = nextDigestRun(
      { cadence: 'MONTHLY', weekday: null, monthDay: 28, hour: 11 },
      now,
    )
    expect(monthly?.toISOString()).toBe('2026-10-28T14:00:00.000Z')
    expect(
      nextDigestRun(
        { cadence: 'MONTHLY', weekday: null, monthDay: null, hour: 11 },
        now,
      ),
    ).toBeNull()
  })

  it('formats the subject date in São Paulo and knows the look-back', () => {
    // 01:00 UTC on the 1st is still the 31st in São Paulo.
    const now = new Date('2026-11-01T01:00:00.000Z')
    expect(digestDateLabel(now)).toBe('31 de outubro de 2026')
    expect(digestSubject(`Resumo de ${DIGEST_DATE_TOKEN}`, now)).toBe(
      'Resumo de 31 de outubro de 2026',
    )
    expect(digestSubject('x'.repeat(250), now)).toHaveLength(200)
    expect(firstDigestLookbackDays('WEEKLY')).toBe(7)
    expect(firstDigestLookbackDays('MONTHLY')).toBe(31)
  })
})

describe('A/B helpers', () => {
  const a = {
    variant: 'A' as const,
    recipients: 10,
    sent: 10,
    opened: 3,
    clicked: 1,
  }
  const b = {
    variant: 'B' as const,
    recipients: 10,
    sent: 10,
    opened: 5,
    clicked: 1,
  }

  it('sizes the test share with at least 2 and at most the audience', () => {
    expect(abShareSize(100, 20)).toBe(20)
    expect(abShareSize(5, 10)).toBe(2)
    expect(abShareSize(1, 50)).toBe(1)
  })

  it('picks the better rate; ties and missing data keep A', () => {
    expect(pickAbWinner([a, b], 'OPENS')).toBe('B')
    expect(pickAbWinner([a, b], 'CLICKS')).toBe('A')
    expect(pickAbWinner([a], 'OPENS')).toBe('A')
    expect(pickAbWinner([b], 'OPENS')).toBe('B')
    expect(abRate({ ...a, sent: 0 }, 'OPENS')).toBe(0)
    expect(abDecideAt(new Date('2026-10-28T10:00:00Z'), 4).toISOString()).toBe(
      '2026-10-28T14:00:00.000Z',
    )
  })
})

describe('digest document', () => {
  it('builds a valid issue with logo, title, intro and the posts', async () => {
    const doc = buildDigestDocument({
      title: 'Resumo de 28 de outubro',
      intro: 'Os destaques da semana.\n\nBoa leitura!',
      posts: POSTS,
      preheader: 'Como escolher um plano · Sem imagem',
    })
    const checked = valid(doc)
    expect(checked.ok).toBe(true)
    const { html, text } = await renderEmailDocument(doc, {
      brand: { ...DEFAULT_EMAIL_BRAND, companyName: 'Acme' },
      subject: 'Resumo',
    })
    expect(html).toContain('Resumo de 28 de outubro')
    expect(html).toContain('href="https://acme.sites.steel.app/blog/planos"')
    expect(html).toContain('src="https://cdn.acme.com.br/capa.png"')
    expect(html).toContain('Ler mais')
    expect(text).toContain('Sem imagem')
    expect(html).toContain('Boa leitura!')
  })

  it('keeps the template body styles and footer, and works without posts', () => {
    const template = createBlankEmailDocument()
    const root = template.nodes[template.rootId]
    root.props = { ...root.props, backgroundColor: '#ABCDEF' }
    template.nodes.footer.props = {
      ...template.nodes.footer.props,
      note: 'Nota da marca',
    }
    const doc = buildDigestDocument({
      title: 'T',
      intro: null,
      posts: [],
      preheader: '',
      template,
    })
    expect(valid(doc).ok).toBe(true)
    expect(doc.nodes[doc.rootId].props.backgroundColor).toBe('#ABCDEF')
    expect(doc.nodes.footer.props.note).toBe('Nota da marca')
    expect(doc.nodes[doc.rootId].children).toEqual(['digest-header', 'footer'])
    // Garbage template falls back to the defaults.
    expect(
      valid(
        buildDigestDocument({
          title: 'T',
          intro: null,
          posts: POSTS,
          preheader: '',
          template: { nope: true },
        }),
      ).ok,
    ).toBe(true)
  })

  it('drops posts without an http(s) link and unsafe images', () => {
    const items = toPostItems([
      ...POSTS,
      { title: 'ftp', excerpt: '', url: 'ftp://x/y', imageUrl: null },
      { title: '', excerpt: '', url: 'https://x.com', imageUrl: null },
      {
        title: 'img estranha',
        excerpt: 'e',
        url: 'https://x.com/a',
        imageUrl: 'data:image/png;base64,AAAA',
      },
    ])
    expect(items.map((item) => item.title)).toEqual([
      'Como escolher um plano',
      'Sem imagem',
      'img estranha',
    ])
    expect(items[2].image).toEqual({ src: '', alt: '' })
    expect(postsSection([])).toBeNull()
    const section = postsSection(POSTS, { heading: 'Leia no blog' })
    expect(section?.nodes[section.rootId].type).toBe('email.section')
    expect(
      Object.values(section?.nodes ?? {}).some((n) => n.type === POSTS_BLOCK),
    ).toBe(true)
  })

  it('extracts the plain text of a document for the AI (no footer)', () => {
    const doc = buildDigestDocument({
      title: 'Resumo',
      intro: 'Olá {{primeiro_nome}}',
      posts: POSTS,
      preheader: '',
    })
    const text = documentText(doc)
    expect(text).toContain('Resumo')
    expect(text).toContain('{{primeiro_nome}}')
    expect(text).toContain('Como escolher um plano')
    expect(text).toContain('Um guia rápido.')
    expect(documentText(doc, 10)).toHaveLength(10)
    expect(documentText(null)).toBe('')
    const list = emailDocument([
      [
        [
          {
            type: 'email.list',
            props: { items: [{ title: 'Item A', text: 'Texto e mais' }] },
          },
          {
            type: 'email.text',
            props: { html: '<p>Texto <strong>forte</strong> &amp; claro</p>' },
          },
        ],
      ],
    ])
    const listText = documentText(list)
    expect(listText).toContain('Item A')
    expect(listText).toContain('Texto forte & claro')
    expect(listText).not.toContain('<strong>')
  })
})

describe('posts block', () => {
  it('renders in the editor with hints and hides empty items in the output', async () => {
    const doc = emailDocument([
      [[{ type: POSTS_BLOCK, props: { items: [emptyPostItem()] } }]],
    ])
    expect(renderEditing(doc)).toContain('Título do post')
    const empty = emailDocument([
      [
        [
          {
            type: POSTS_BLOCK,
            props: {
              items: [{ ...emptyPostItem(), title: '' }],
              layout: 'vertical',
            },
          },
        ],
      ],
    ])
    const { html } = await renderEmailDocument(empty, {
      brand: DEFAULT_EMAIL_BRAND,
      subject: 'x',
    })
    expect(html).not.toContain('Ler mais')
    expect(renderEditing(empty)).toContain('Ler mais')
  })

  it('renders stacked and side by side, with and without images', async () => {
    const item = {
      ...emptyPostItem(),
      title: 'Post',
      image: { src: 'https://cdn.x/a.png', alt: '' },
      link: { type: 'url' as const, value: 'https://x.com/post' },
    }
    for (const layout of ['vertical', 'horizontal'] as const) {
      const doc = emailDocument([
        [
          [
            {
              type: POSTS_BLOCK,
              props: { items: [item, { ...item, title: 'Outro' }], layout },
            },
          ],
        ],
      ])
      const { html } = await renderEmailDocument(doc, {
        brand: DEFAULT_EMAIL_BRAND,
        subject: 'x',
      })
      expect(html).toContain('src="https://cdn.x/a.png"')
      expect(html).toContain('alt="Post"')
    }
    const noImages = emailDocument([
      [
        [
          {
            type: POSTS_BLOCK,
            props: { items: [item], showImages: false, linkLabel: '' },
          },
        ],
      ],
    ])
    const { html } = await renderEmailDocument(noImages, {
      brand: DEFAULT_EMAIL_BRAND,
      subject: 'x',
    })
    expect(html).not.toContain('cdn.x/a.png')
    expect(html).not.toContain('→')
  })

  it('falls back to the palette when the accent color does not resolve', async () => {
    const doc = emailDocument([
      [
        [
          {
            type: POSTS_BLOCK,
            props: {
              items: [{ ...emptyPostItem(), title: 'Post' }],
              accentColor: undefined,
            },
          },
        ],
      ],
    ])
    const { html } = await renderEmailDocument(doc, {
      brand: DEFAULT_EMAIL_BRAND,
      subject: 'x',
    })
    expect(html).toContain('Ler mais')
  })

  it('refuses an empty list', () => {
    const definition = emailCatalog.components[POSTS_BLOCK]
    const props = { ...definition.defaultProps(), items: [] }
    expect(definition.propsSchema.safeParse(props).success).toBe(false)
  })
})

describe('replaceContentOp', () => {
  it('swaps every section for the AI sections in one undoable step', () => {
    const doc = createBlankEmailDocument()
    const store = createCanvasStore(emailCatalog, doc)
    const section = postsSection(POSTS, { prefix: 'p' }) as CanvasFragment
    const op = replaceContentOp(store.getState().doc, [section, section])
    expect(op).not.toBeNull()
    expect(store.dispatch(op as NonNullable<typeof op>)).toBe(true)
    const next = store.getState().doc
    const children = next.nodes[next.rootId].children ?? []
    expect(children).toHaveLength(3)
    expect(children[2]).toBe('footer')
    expect(children).not.toContain('section')
    expect(new Set(children).size).toBe(3)
    store.undo()
    expect(store.getState().doc.nodes[next.rootId].children).toEqual([
      'section',
      'footer',
    ])
    expect(replaceContentOp(doc, [])).toBeNull()
  })
})
