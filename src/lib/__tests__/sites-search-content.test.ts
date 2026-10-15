import { describe, expect, it } from 'vitest'
import {
  searchDocument,
  words,
} from '@/src/__tests__/factories/site-search.factory'
import { applyOp, cloneFragment, getNode } from '@/src/lib/canvas/ops'
import { siteCatalog } from '@/src/lib/canvas-site'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import {
  box,
  button,
  heading,
  image,
  list,
  social,
  spec,
  text,
} from '@/src/lib/canvas-site/presets/builder'
import { extractPageContent } from '@/src/lib/sites/search/content'
import {
  faqSectionFragment,
  faqSectionLocation,
  findFaqSection,
  SEARCH_FAQ_SECTION_NAME,
  summaryFragment,
  summaryLocation,
} from '@/src/lib/sites/search/fixes'

const url = (value: string) => ({ type: 'url' as const, value })

describe('extractPageContent', () => {
  it('reads headings, blocks, images and links in order', () => {
    const doc = searchDocument(
      heading('h1', 'Implante dentário', { link: url('/contato') }),
      text(
        '<p>Texto com <a href="https://www.gov.br/saude">fonte</a>, <a href="/precos">preços</a>, <a href="mailto:x@y.z">mail</a> e <a href="">vazio</a>.</p><ul><li>Um</li></ul><ol><li>Dois</li></ol>',
      ),
      list(['Primeiro passo', 'Segundo passo'], { marker: 'number' }),
      list([' ', '']),
      image('/media/foto.png', 'Foto do consultório', {
        link: url('https://instagram.com/x'),
      }),
      image('/media/sem-alt.png', ''),
      image('', 'sem arquivo'),
      button('Agendar', { type: 'page', value: 'p2' }),
      button('Ligar', { type: 'phone', value: '1199999' }),
      button('Sem destino', { type: 'url', value: '  ' }),
      spec(SITE_TYPES.icon, {
        name: 'check',
        link: url('//cdn.exemplo.com/a'),
      }),
      spec(SITE_TYPES.menu, {
        items: [{ label: 'Início', link: { type: 'anchor', value: 'topo' } }],
      }),
      social(['instagram']),
      spec(SITE_TYPES.social, { items: [{ network: 'x', url: '' }] }),
      spec(SITE_TYPES.gallery, {
        items: [
          { image: { src: '/g.png', alt: 'Galeria' } },
          { image: { src: '', alt: '' } },
        ],
      }),
      spec(SITE_TYPES.logos, {
        items: [
          {
            image: { src: '/l.png' },
            link: { type: 'file', value: '/doc.pdf' },
          },
        ],
      }),
      spec(SITE_TYPES.testimonials, {
        items: [
          { quote: 'Ótimo atendimento', name: 'Ana' },
          { name: 'Sem citação' },
        ],
      }),
      spec(SITE_TYPES.pricing, {
        items: [
          {
            name: 'Básico',
            price: 'R$ 100',
            features: '',
            buttonLabel: 'Ok',
            link: url('https://pague.com'),
          },
        ],
      }),
      spec(SITE_TYPES.stats, {
        items: [{ value: 300, suffix: '+', label: 'pacientes' }],
      }),
      spec(SITE_TYPES.stats, { items: 'inválido' }),
    )
    const content = extractPageContent(doc)

    expect(content.headings).toEqual([
      { id: expect.any(String), level: 1, text: 'Implante dentário' },
    ])
    expect(content.blocks.map((block) => block.kind)).toEqual([
      'text',
      'list',
      'other',
      'other',
      'other',
    ])
    expect(content.lists).toBe(3)
    expect(content.numberedLists).toBe(2)
    expect(content.tables).toBe(3)
    expect(content.images.map((item) => item.alt)).toEqual([
      'Foto do consultório',
      '',
      'Galeria',
      '',
    ])
    expect(content.links).toEqual([
      { href: '/contato', internal: true },
      { href: 'https://www.gov.br/saude', internal: false },
      { href: '/precos', internal: true },
      { href: 'https://instagram.com/x', internal: false },
      { href: 'p2', internal: true },
      { href: '//cdn.exemplo.com/a', internal: false },
      { href: 'topo', internal: true },
      { href: 'https://instagram.com/', internal: false },
      { href: '/doc.pdf', internal: true },
      { href: 'https://pague.com', internal: false },
    ])
    expect(content.blocks.at(-1)?.text).toBe('300 + pacientes')
    expect(content.words).toBeGreaterThan(10)
    expect(content.flow[0]).toMatchObject({ type: 'heading', level: 1 })
  })

  it('reads accordions as Q&A and skips hidden or empty nodes', () => {
    const doc = searchDocument(
      heading('h2', ''),
      text(''),
      spec(SITE_TYPES.accordion, {}, [
        spec(SITE_TYPES.accordionItem, { title: 'Quanto custa?' }, [
          heading('h4', 'Depende'),
          text('<p>Do caso.</p>'),
          list(['Avaliação grátis']),
          box({}, [text('<p>Aninhado.</p>')]),
        ]),
        spec(SITE_TYPES.accordionItem, { title: 'Sem resposta' }),
        spec(SITE_TYPES.accordionItem, { title: '' }, [text('<p>Órfã</p>')]),
      ]),
      heading('h3', 'Oculto'),
    )
    const hiddenId = Object.values(doc.nodes).find(
      (node) =>
        node.type === SITE_TYPES.heading && node.props.text === 'Oculto',
    )?.id as string
    doc.nodes[hiddenId].meta = { hidden: true }
    const hiddenChild = Object.values(doc.nodes).find(
      (node) =>
        node.type === SITE_TYPES.text && node.props.html === '<p>Aninhado.</p>',
    )?.id as string
    doc.nodes[hiddenChild].meta = { hidden: true }
    // A dangling child and a cycle do not break the walk.
    const section = getNode(doc, doc.nodes[doc.rootId].children?.[0] as string)
    section?.children?.push('missing', section.id)

    const content = extractPageContent(doc)
    expect(content.faq).toEqual([
      {
        question: 'Quanto custa?',
        answer: 'Depende Do caso. Avaliação grátis',
      },
    ])
    expect(content.headings).toEqual([])
    expect(
      content.flow
        .filter((item) => item.type === 'heading')
        .map((item) => item.text),
    ).toEqual(['Quanto custa?', 'Sem resposta'])
    expect(content.blocks.map((block) => block.kind)).toEqual([
      'answer',
      'answer',
    ])
  })

  it('defaults a heading without level to H2', () => {
    const doc = searchDocument(heading('h3', 'Título'))
    const id = Object.values(doc.nodes).find(
      (node) => node.type === SITE_TYPES.heading,
    )?.id as string
    doc.nodes[id].props.level = undefined
    expect(extractPageContent(doc).headings[0].level).toBe(2)
    doc.nodes[id].props.level = 'hx'
    expect(extractPageContent(doc).headings[0].level).toBe(2)
  })
})

describe('one-click fix fragments', () => {
  it('builds a valid questions section and finds it again', () => {
    expect(
      faqSectionFragment([{ question: 'Só pergunta', answer: ' ' }]),
    ).toBeNull()
    const fragment = faqSectionFragment([
      {
        question: 'Quanto custa?',
        answer: 'Depende <do> caso.\n\nSegundo & parágrafo\nlinha',
      },
      { question: 'Sem resposta', answer: '' },
    ])
    expect(fragment).not.toBeNull()
    const doc = searchDocument(heading('h1', 'Página'))
    const { at, replaces } = faqSectionLocation(doc)
    expect(replaces).toBeNull()
    const inserted = applyOp(
      doc,
      {
        kind: 'insert',
        fragment: cloneFragment(fragment as NonNullable<typeof fragment>),
        at,
      },
      siteCatalog,
    )
    expect(inserted.ok).toBe(true)
    if (!inserted.ok) return
    const next = inserted.value.doc
    const sectionId = findFaqSection(next)
    expect(getNode(next, sectionId as string)?.meta?.name).toBe(
      SEARCH_FAQ_SECTION_NAME,
    )
    expect(faqSectionLocation(next)).toEqual({
      at: { parentId: next.rootId, index: 1 },
      replaces: sectionId,
    })
    const content = extractPageContent(next)
    expect(content.faq).toEqual([
      {
        question: 'Quanto custa?',
        answer: 'Depende <do> caso. Segundo & parágrafo linha',
      },
    ])
    const answer = Object.values(next.nodes).find(
      (node) =>
        node.type === SITE_TYPES.text &&
        String(node.props.html).includes('&amp;'),
    )
    expect(answer?.props.html).toBe(
      '<p>Depende &lt;do&gt; caso.</p><p>Segundo &amp; parágrafo<br>linha</p>',
    )
  })

  it('places the summary right after the H1', () => {
    const doc = searchDocument(heading('h1', 'Página'), text(words(10)))
    const location = summaryLocation(doc)
    const sectionId = doc.nodes[doc.rootId].children?.[0]
    expect(location).toEqual({ parentId: sectionId, index: 1 })
    const fragment = summaryFragment('Resumo da página.')
    expect(fragment.nodes[fragment.rootId].props.preset).toBe('lead')
    expect(summaryLocation(searchDocument(heading('h2', 'Sem H1')))).toBeNull()
    expect(findFaqSection({ ...doc, rootId: 'missing' })).toBeNull()
    expect(faqSectionLocation({ ...doc, rootId: 'missing' }).at.index).toBe(0)
  })
})
