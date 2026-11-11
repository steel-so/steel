import { describe, expect, it, vi } from 'vitest'

const { outlineToDocumentMock } = vi.hoisted(() => ({
  outlineToDocumentMock: vi.fn(),
}))

vi.mock('@/src/lib/canvas-document/outline', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/src/lib/canvas-document/outline')>()
  return { ...actual, outlineToDocument: outlineToDocumentMock }
})

import {
  ACCEPT_BUTTON_LABEL,
  buildNewProposal,
  convertLegacyProposal,
  type LegacyProposalSection,
  legacyPricingItems,
  newProposalOutline,
  plainTextToHtml,
  proposalToOutline,
} from '@/src/lib/canvas-document/convert-proposal'
import { DocumentOutlineSchema } from '@/src/lib/canvas-document/outline'

const FIXTURES: Record<string, Record<string, unknown>> = {
  COVER: {
    type: 'COVER',
    title: 'Proposta comercial',
    subtitle: 'Implantação <2027>',
    coverImageUrl: 'https://cdn.example.com/capa.png',
  },
  COMPANY_PRESENTATION: {
    type: 'COMPANY_PRESENTATION',
    headline: 'Quem somos',
    description: 'Somos a Stratus.\n\nAtendemos todo o Brasil.',
    imageUrls: [
      'https://cdn.example.com/1.png',
      'https://cdn.example.com/2.png',
      'https://cdn.example.com/3.png',
      'https://cdn.example.com/4.png',
    ],
  },
  CLIENT_NEEDS: {
    type: 'CLIENT_NEEDS',
    items: [
      { title: 'Reduzir custos', description: 'Hoje gasta muito.' },
      { title: 'Atender mais rápido', description: '' },
    ],
  },
  SOLUTION: {
    type: 'SOLUTION',
    description: 'Uma plataforma única.',
    imageUrls: ['https://cdn.example.com/solucao.png'],
  },
  SCOPE: {
    type: 'SCOPE',
    items: [{ title: 'Instalação' }, { title: 'Treinamento' }],
  },
  PRODUCTS_PRICING: {
    type: 'PRODUCTS_PRICING',
    items: [
      {
        name: 'Licença',
        description: 'Por usuário',
        quantity: 10,
        unitPrice: 100,
        total: 1000,
      },
      { name: 'Setup', quantity: 1, unitPrice: 1000, total: 1000 },
    ],
    discount: 200,
    total: 1800,
  },
  COMMERCIAL_TERMS: {
    type: 'COMMERCIAL_TERMS',
    paymentTerms: '30 dias',
    deliveryTerms: 'Em 15 dias úteis',
    notes: '',
  },
  TERMS_CONDITIONS: {
    type: 'TERMS_CONDITIONS',
    text: 'Cláusula 1.\nCláusula 2.',
  },
  SIGNATURE: {
    type: 'SIGNATURE',
    companySignerName: 'Marina Lima',
    companySignerRole: 'Diretora',
    clientSignerName: 'Cliente',
  },
}

const ORDER = Object.keys(FIXTURES)

function section(
  type: string,
  overrides: Partial<LegacyProposalSection> = {},
): LegacyProposalSection {
  return {
    type: type as LegacyProposalSection['type'],
    order: ORDER.indexOf(type),
    enabled: true,
    content: FIXTURES[type],
    ...overrides,
  }
}

function allSections(): LegacyProposalSection[] {
  return ORDER.map((type) => section(type))
}

describe('plainTextToHtml', () => {
  it('splits paragraphs, keeps line breaks and escapes HTML', () => {
    expect(plainTextToHtml('a & <b>\r\nlinha\n\n\n"c" \'d\'')).toBe(
      '<p>a &amp; &lt;b&gt;<br>linha</p><p>&quot;c&quot; &#39;d&#39;</p>',
    )
  })

  it('drops blank paragraphs', () => {
    expect(plainTextToHtml('  \n\n  ')).toBe('')
  })
})

describe('legacyPricingItems', () => {
  it('turns the absolute discount into the same percentage per line', () => {
    const items = legacyPricingItems(
      FIXTURES.PRODUCTS_PRICING as Parameters<typeof legacyPricingItems>[0],
    )
    expect(items).toEqual([
      {
        id: 'item-1',
        name: 'Licença',
        description: 'Por usuário',
        unitPrice: 100,
        quantity: 10,
        discountPct: 10,
      },
      {
        id: 'item-2',
        name: 'Setup',
        unitPrice: 1000,
        quantity: 1,
        discountPct: 10,
      },
    ])
    const total = items.reduce((sum, i) => {
      const factor = 1 - (i.discountPct ?? 0) / 100
      return sum + i.unitPrice * i.quantity * factor
    }, 0)
    expect(total).toBeCloseTo(1800, 2)
  })

  it('caps the discount at 100% and skips it on a zero subtotal', () => {
    const capped = legacyPricingItems({
      type: 'PRODUCTS_PRICING',
      items: [{ name: 'A', quantity: 1, unitPrice: 10, total: 10 }],
      discount: 50,
      total: 0,
    })
    expect(capped[0]?.discountPct).toBe(100)

    const free = legacyPricingItems({
      type: 'PRODUCTS_PRICING',
      items: [{ name: 'A', quantity: 1, unitPrice: 0, total: 0 }],
      discount: 5,
      total: 0,
    })
    expect(free[0]).not.toHaveProperty('discountPct')
  })
})

describe('proposalToOutline', () => {
  it('converts every section type into a valid outline', () => {
    const outline = proposalToOutline({
      title: 'Proposta ACME',
      sections: allSections(),
      logoUrl: ' https://cdn.example.com/logo.png ',
      hasValidity: true,
    })

    expect(DocumentOutlineSchema.safeParse(outline).success).toBe(true)
    expect(outline.kind).toBe('PROPOSAL')
    expect(outline.title).toBe('Proposta ACME')
    expect(outline.theme).toEqual({
      logoUrl: 'https://cdn.example.com/logo.png',
    })
    expect(outline.sections.map((s) => s.name)).toEqual([
      'Capa',
      'Apresentação da empresa',
      'Necessidade do cliente',
      'Solução da proposta',
      'Escopo dos serviços',
      'Produtos e valores',
      'Condições comerciais',
      'Termos e condições',
      'Aceite',
    ])
  })

  it('maps the cover to a cover section with image, title and subtitle', () => {
    const [cover] = proposalToOutline({
      title: 'X',
      sections: [section('COVER')],
      ensureAccept: false,
    }).sections
    expect(cover).toEqual({
      name: 'Capa',
      variant: 'cover',
      blocks: [
        { type: 'image', src: 'https://cdn.example.com/capa.png', alt: '' },
        { type: 'heading', text: 'Proposta comercial', level: 1 },
        { type: 'text', html: '<p>Implantação &lt;2027&gt;</p>' },
      ],
    })
  })

  it('keeps a cover without image or subtitle to the title', () => {
    const [cover] = proposalToOutline({
      title: 'X',
      sections: [
        section('COVER', { content: { type: 'COVER', title: 'Só título' } }),
      ],
      ensureAccept: false,
    }).sections
    expect(cover?.blocks).toEqual([
      { type: 'heading', text: 'Só título', level: 1 },
    ])
  })

  it('lays out presentation images in rows of three', () => {
    const [presentation] = proposalToOutline({
      title: 'X',
      sections: [section('COMPANY_PRESENTATION')],
      ensureAccept: false,
    }).sections
    expect(presentation?.blocks).toEqual([
      { type: 'heading', text: 'Quem somos', level: 2 },
      {
        type: 'text',
        html: '<p>Somos a Stratus.</p><p>Atendemos todo o Brasil.</p>',
      },
      {
        type: 'columns',
        columns: [
          [{ type: 'image', src: 'https://cdn.example.com/1.png', alt: '' }],
          [{ type: 'image', src: 'https://cdn.example.com/2.png', alt: '' }],
          [{ type: 'image', src: 'https://cdn.example.com/3.png', alt: '' }],
        ],
      },
      { type: 'image', src: 'https://cdn.example.com/4.png', alt: '' },
    ])
  })

  it('uses the section name when the presentation has no headline', () => {
    const [presentation] = proposalToOutline({
      title: 'X',
      sections: [
        section('COMPANY_PRESENTATION', {
          content: {
            type: 'COMPANY_PRESENTATION',
            description: 'Texto',
            imageUrls: [],
          },
        }),
      ],
      ensureAccept: false,
    }).sections
    expect(presentation?.blocks[0]).toEqual({
      type: 'heading',
      text: 'Apresentação da empresa',
      level: 2,
    })
  })

  it('maps described needs to headings and the solution to text', () => {
    const [needs, solution] = proposalToOutline({
      title: 'X',
      sections: [section('CLIENT_NEEDS'), section('SOLUTION')],
      ensureAccept: false,
    }).sections
    expect(needs?.blocks).toEqual([
      { type: 'heading', text: 'Necessidade do cliente', level: 2 },
      { type: 'heading', text: 'Reduzir custos', level: 3 },
      { type: 'text', html: '<p>Hoje gasta muito.</p>' },
      { type: 'heading', text: 'Atender mais rápido', level: 3 },
    ])
    expect(solution?.blocks).toEqual([
      { type: 'heading', text: 'Solução da proposta', level: 2 },
      { type: 'text', html: '<p>Uma plataforma única.</p>' },
      { type: 'image', src: 'https://cdn.example.com/solucao.png', alt: '' },
    ])
  })

  it('maps a scope without descriptions to a list', () => {
    const [scope] = proposalToOutline({
      title: 'X',
      sections: [section('SCOPE')],
      ensureAccept: false,
    }).sections
    expect(scope?.blocks).toEqual([
      { type: 'heading', text: 'Escopo dos serviços', level: 2 },
      { type: 'list', items: ['Instalação', 'Treinamento'] },
    ])
  })

  it('folds many described items into one list', () => {
    const items = Array.from({ length: 45 }, (_, i) => ({
      title: `Item ${i + 1}`,
      description: i === 0 ? 'Detalhe' : '',
    }))
    const [scope] = proposalToOutline({
      title: 'X',
      sections: [section('SCOPE', { content: { type: 'SCOPE', items } })],
      ensureAccept: false,
    }).sections
    const list = scope?.blocks[1]
    expect(list?.type).toBe('list')
    expect(list && 'items' in list ? list.items.slice(0, 2) : []).toEqual([
      'Item 1 — Detalhe',
      'Item 2',
    ])
  })

  it('maps products & pricing to a pricing block with totals', () => {
    const [pricing] = proposalToOutline({
      title: 'X',
      sections: [section('PRODUCTS_PRICING')],
      ensureAccept: false,
    }).sections
    expect(pricing?.blocks[0]).toEqual({
      type: 'heading',
      text: 'Produtos e valores',
      level: 2,
    })
    expect(pricing?.blocks[1]).toMatchObject({
      type: 'pricing',
      showTotals: true,
      items: [{ id: 'item-1' }, { id: 'item-2' }],
    })
  })

  it('splits more than 100 lines into pricing blocks with one total', () => {
    const items = Array.from({ length: 150 }, (_, i) => ({
      name: `Linha ${i}`,
      quantity: 1,
      unitPrice: 1,
      total: 1,
    }))
    const outline = proposalToOutline({
      title: 'X',
      sections: [
        section('PRODUCTS_PRICING', {
          content: { type: 'PRODUCTS_PRICING', items, discount: 0, total: 150 },
        }),
      ],
      ensureAccept: false,
    })
    const blocks = outline.sections[0]?.blocks.slice(1) ?? []
    expect(blocks).toHaveLength(2)
    const totals = blocks.map((b) =>
      b.type === 'pricing' ? b.showTotals : null,
    )
    expect(totals).toEqual([false, true])
    expect(DocumentOutlineSchema.safeParse(outline).success).toBe(true)
  })

  it('maps short commercial terms to a table, skipping empty rows', () => {
    const [terms] = proposalToOutline({
      title: 'X',
      sections: [section('COMMERCIAL_TERMS')],
      ensureAccept: false,
    }).sections
    expect(terms?.blocks).toEqual([
      { type: 'heading', text: 'Condições comerciais', level: 2 },
      {
        type: 'table',
        rows: [
          ['Pagamento', '30 dias'],
          ['Entrega', 'Em 15 dias úteis'],
        ],
      },
    ])
  })

  it('maps long commercial terms to headings + text', () => {
    const long = 'x'.repeat(1200)
    const [terms] = proposalToOutline({
      title: 'X',
      sections: [
        section('COMMERCIAL_TERMS', {
          content: {
            type: 'COMMERCIAL_TERMS',
            paymentTerms: long,
            notes: 'Obs',
          },
        }),
      ],
      ensureAccept: false,
    }).sections
    expect(terms?.blocks).toEqual([
      { type: 'heading', text: 'Condições comerciais', level: 2 },
      { type: 'heading', text: 'Pagamento', level: 3 },
      { type: 'text', html: `<p>${long}</p>` },
      { type: 'heading', text: 'Observações', level: 3 },
      { type: 'text', html: '<p>Obs</p>' },
    ])
  })

  it('maps terms & conditions to text, split under the HTML limit', () => {
    // Escaping makes each paragraph longer than the HTML limit of a block.
    const big = Array.from({ length: 2 }, () => '&'.repeat(4500)).join('\n\n')
    const outline = proposalToOutline({
      title: 'X',
      sections: [
        section('TERMS_CONDITIONS', {
          content: { type: 'TERMS_CONDITIONS', text: big },
        }),
      ],
      ensureAccept: false,
    })
    const blocks = outline.sections[0]?.blocks ?? []
    expect(blocks[0]).toEqual({
      type: 'heading',
      text: 'Termos e condições',
      level: 2,
    })
    expect(blocks.slice(1).map((b) => b.type)).toEqual(['text', 'text'])
    expect(DocumentOutlineSchema.safeParse(outline).success).toBe(true)

    const [small] = proposalToOutline({
      title: 'X',
      sections: [section('TERMS_CONDITIONS')],
      ensureAccept: false,
    }).sections
    expect(small?.blocks[1]).toEqual({
      type: 'text',
      html: '<p>Cláusula 1.<br>Cláusula 2.</p>',
    })
  })

  it('turns the signature section into an accept block with the signer', () => {
    const [accept] = proposalToOutline({
      title: 'X',
      sections: [section('SIGNATURE')],
      hasValidity: true,
    }).sections
    expect(accept).toEqual({
      name: 'Aceite',
      blocks: [
        {
          type: 'text',
          html: '<p>Responsável: <strong>Marina Lima — Diretora</strong></p>',
        },
        { type: 'validity' },
        {
          type: 'accept',
          buttonLabel: ACCEPT_BUTTON_LABEL,
          allowDecline: true,
        },
      ],
    })
  })

  it('skips the signer line when the signer name is blank', () => {
    const [accept] = proposalToOutline({
      title: 'X',
      sections: [
        section('SIGNATURE', {
          content: { type: 'SIGNATURE', companySignerName: ' ' },
        }),
      ],
    }).sections
    expect(accept?.blocks.map((b) => b.type)).toEqual(['accept'])
  })

  it('skips disabled, empty, invalid and mismatched sections', () => {
    const outline = proposalToOutline({
      title: 'X',
      sections: [
        section('COVER', { enabled: false }),
        section('SOLUTION', { content: null }),
        section('SCOPE', { content: { type: 'SCOPE', items: [] } }),
        section('CLIENT_NEEDS', { content: FIXTURES.SCOPE }),
        section('SIGNATURE', { enabled: false }),
      ],
      ensureAccept: false,
    })
    expect(outline.sections).toEqual([
      { name: 'Proposta', blocks: [{ type: 'heading', text: 'X', level: 1 }] },
    ])
  })

  it('appends an accept section when the signature is off', () => {
    const outline = proposalToOutline({
      title: '  ',
      sections: [section('COVER'), section('SIGNATURE', { enabled: false })],
    })
    expect(outline.title).toBe('Proposta')
    expect(outline.sections.at(-1)).toEqual({
      name: 'Aceite',
      blocks: [
        {
          type: 'accept',
          buttonLabel: ACCEPT_BUTTON_LABEL,
          allowDecline: true,
        },
      ],
    })
    expect(outline.theme).toBeUndefined()
  })

  it('orders sections by their stored order, then by the legacy order', () => {
    const outline = proposalToOutline({
      title: 'X',
      sections: [
        section('TERMS_CONDITIONS', { order: 0 }),
        section('SOLUTION', { order: 5 }),
        section('COVER', { order: 5 }),
      ],
      ensureAccept: false,
    })
    expect(outline.sections.map((s) => s.name)).toEqual([
      'Termos e condições',
      'Capa',
      'Solução da proposta',
    ])
  })

  it('clips long titles to the outline limits', () => {
    const outline = proposalToOutline({
      title: 't'.repeat(250),
      sections: [
        section('COVER', {
          content: { type: 'COVER', title: 'h'.repeat(200) },
        }),
      ],
    })
    expect(outline.title).toHaveLength(200)
    expect(DocumentOutlineSchema.safeParse(outline).success).toBe(true)
  })
})

describe('convertLegacyProposal', () => {
  it('builds the outline and hands it to outlineToDocument', () => {
    const content = { version: 1, rootId: 'root', nodes: {} }
    outlineToDocumentMock.mockReturnValue({ content, theme: { a: 1 } })

    const result = convertLegacyProposal({
      title: 'Proposta',
      sections: [section('COVER')],
    })

    expect(outlineToDocumentMock).toHaveBeenCalledWith(result.outline)
    expect(result.content).toBe(content)
    expect(result.theme).toEqual({ a: 1 })
    expect(result.outline.sections[0]?.variant).toBe('cover')
  })
})

describe('newProposalOutline', () => {
  it('starts with a cover for the client, the pricing and the accept', () => {
    const outline = newProposalOutline({
      title: 'Proposta Rede Sol',
      clientName: 'Rede <Sol>',
      items: [{ id: 'l1', name: 'Plano', unitPrice: 99, quantity: 2 }],
      hasValidity: true,
    })
    expect(DocumentOutlineSchema.safeParse(outline).success).toBe(true)
    expect(outline.sections.map((s) => s.name)).toEqual([
      'Capa',
      'Produtos e valores',
      'Aceite',
    ])
    expect(outline.sections[0]?.blocks[1]).toEqual({
      type: 'text',
      html: '<p>Preparada para Rede &lt;Sol&gt;</p>',
    })
    expect(outline.sections[1]?.blocks[1]).toMatchObject({
      type: 'pricing',
      showTotals: true,
      items: [{ id: 'l1' }],
    })
    expect(outline.sections[2]?.blocks.map((b) => b.type)).toEqual([
      'validity',
      'accept',
    ])
  })

  it('skips the client line and the pricing when there is nothing', () => {
    const outline = newProposalOutline({ title: ' ' })
    expect(outline.title).toBe('Proposta')
    expect(outline.sections.map((s) => s.name)).toEqual(['Capa', 'Aceite'])
    expect(outline.sections[0]?.blocks).toHaveLength(1)
  })

  it('buildNewProposal hands the outline to outlineToDocument', () => {
    outlineToDocumentMock.mockReturnValue({ content: { x: 1 }, theme: {} })
    const result = buildNewProposal({ title: 'Nova' })
    expect(result.content).toEqual({ x: 1 })
    expect(outlineToDocumentMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Nova', kind: 'PROPOSAL' }),
    )
  })
})
