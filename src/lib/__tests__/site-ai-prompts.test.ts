import { describe, expect, it, vi } from 'vitest'
import {
  estimateSiteAi,
  estimateSiteGeneration,
  SITE_AI_TYPICAL_USAGE,
} from '@/src/lib/site-ai/estimate'
import {
  briefLines,
  buildImagesSystem,
  buildPageCopySystem,
  buildPlanSystem,
  buildRewriteSystem,
  buildSectionChoiceSystem,
  buildSectionCopySystem,
  checkFields,
  describeSlots,
  missingFields,
} from '@/src/lib/site-ai/prompts'
import type { TextSlot } from '@/src/lib/site-ai/slots'
import {
  encodeSiteAiEvent,
  SITE_AI_HEARTBEAT_MS,
  siteAiSseResponse,
} from '@/src/lib/site-ai/sse'
import type { SiteAiEvent } from '@/types/site-ai'

const DTO = {
  name: 'Pão & Cia',
  business: 'Padaria artesanal no centro de Campinas',
  audience: 'Famílias do bairro',
  goal: 'leads' as const,
  tone: 'friendly' as const,
  extra: 'Abrimos aos domingos',
}

const slot = (overrides: Partial<TextSlot>): TextSlot => ({
  id: 't1',
  nodeId: 'n1',
  path: ['text'],
  role: 'Título h1',
  current: 'Exemplo',
  max: 90,
  rich: false,
  multiline: false,
  section: 'Destaque',
  ...overrides,
})

describe('briefLines', () => {
  it('lists the brief, products, testimonials and the event date', () => {
    const lines = briefLines(DTO, {
      products: [
        { name: 'Pão', price: 'R$ 10,00', description: 'Fermentação natural' },
        { name: 'Bolo', price: 'R$ 40,00', description: '' },
      ],
      testimonials: [{ quote: 'Ótimo', name: 'Ana', role: '' }],
      eventDate: '2026-12-01',
    })
    expect(lines).toEqual([
      'Empresa: Pão & Cia',
      'O que a empresa faz: Padaria artesanal no centro de Campinas',
      'Público: Famílias do bairro',
      'Objetivo do site: Gerar contatos',
      'Tom de voz: Próximo e amigável',
      'Data do evento: 2026-12-01',
      'Produtos do CRM (nome, preço e descrição reais):',
      '- Pão — R$ 10,00 — Fermentação natural',
      '- Bolo — R$ 40,00',
      'Há 1 depoimento(s) real(is) de clientes disponível(is).',
      'Observações do cliente: Abrimos aos domingos',
    ])
  })

  it('leaves optional lines out', () => {
    const lines = briefLines(
      { ...DTO, audience: '', extra: '' },
      { products: [], testimonials: [], eventDate: null },
    )
    expect(lines).toHaveLength(4)
  })
})

describe('system prompts', () => {
  it('plans exactly the requested pages with the section vocabulary', () => {
    const system = buildPlanSystem(['home', 'contact'])
    expect(system).toContain('home, contact')
    expect(system).toContain('- hero:')
    expect(system).toContain('"geist" (Geist)')
    expect(system).toContain('Nunca invente números')
  })

  it('writes page copy with real testimonials when there are some', () => {
    const withQuotes = buildPageCopySystem({
      brief: ['Empresa: X'],
      pageTitle: 'Início',
      testimonials: [
        { quote: 'Bom', name: 'Ana', role: 'Cliente' },
        { quote: 'Ótimo', name: 'Rui', role: '' },
      ],
    })
    expect(withQuotes).toContain('"Início"')
    expect(withQuotes).toContain('- "Bom" — Ana, Cliente')
    expect(withQuotes).toContain('- "Ótimo" — Rui')
    expect(withQuotes).toContain('rocket')
    const without = buildPageCopySystem({
      brief: [],
      pageTitle: 'Sobre',
      testimonials: [],
    })
    expect(without).not.toContain('Depoimentos reais')
  })

  it('chooses and writes editor sections with the page context', () => {
    const choice = buildSectionChoiceSystem({
      siteName: 'Pão',
      pageTitle: '',
      headings: ['Nossos pães'],
    })
    expect(choice).toContain('Página: sem título')
    expect(choice).toContain('Nossos pães')
    expect(choice).toContain('- cta:')
    expect(
      buildSectionChoiceSystem({
        siteName: 'Pão',
        pageTitle: 'A',
        headings: [],
      }),
    ).not.toContain('Títulos que já')

    const copy = buildSectionCopySystem({
      siteName: 'Pão',
      pageTitle: 'Início',
      headings: ['Nossos pães'],
      prompt: 'Três diferenciais',
    })
    expect(copy).toContain('Pedido do usuário: Três diferenciais')
    expect(copy).toContain('não repita')
    expect(
      buildSectionCopySystem({
        siteName: 'Pão',
        pageTitle: '',
        headings: [],
        prompt: 'x',
      }),
    ).toContain('"sem título"')
  })

  it('rewrites with tone, length and the user instructions', () => {
    const shorter = buildRewriteSystem({
      siteName: 'Pão',
      tone: 'formal',
      length: 'shorter',
      instructions: 'Cite o bairro',
    })
    expect(shorter).toContain('"Formal" (mais curto)')
    expect(shorter).toContain('metade do tamanho')
    expect(shorter).toContain('Instruções do usuário: Cite o bairro')
    expect(
      buildRewriteSystem({
        siteName: 'Pão',
        tone: 'casual',
        length: 'longer',
        instructions: '',
      }),
    ).not.toContain('Instruções do usuário')
    expect(
      buildRewriteSystem({
        siteName: 'Pão',
        tone: 'casual',
        length: 'same',
        instructions: '',
      }),
    ).toContain('tamanho de cada texto parecido')
  })

  it('asks images only from the given list', () => {
    expect(buildImagesSystem('Pão')).toContain('Use só ids da lista')
  })
})

describe('slot answers', () => {
  const slots = [
    slot({ id: 't1' }),
    slot({ id: 't2', section: 'Destaque', role: 'Parágrafo', multiline: true }),
    slot({ id: 't3', section: '', current: '' }),
  ]

  it('groups the fields by section with role, cap and example', () => {
    expect(describeSlots(slots)).toBe(
      [
        '## Seção: Destaque',
        '- t1 [Título h1, máx. 90 caracteres]: "Exemplo"',
        '- t2 [Parágrafo, máx. 90 caracteres, pode ter parágrafos]: "Exemplo"',
        '## Seção: Página',
        '- t3 [Título h1, máx. 90 caracteres]: (vazio)',
      ].join('\n'),
    )
  })

  it('reports missing or empty fields', () => {
    const fields = [
      { id: 't1', text: 'Oi' },
      { id: 't2', text: '  ' },
    ]
    expect(missingFields(slots, fields)).toEqual(['t2', 't3'])
    expect(checkFields(slots, fields)).toEqual([
      'Faltaram estes campos (devolva todos): t2, t3',
    ])
    expect(
      checkFields(slots, [
        { id: 't1', text: 'a' },
        { id: 't2', text: 'b' },
        { id: 't3', text: 'c' },
      ]),
    ).toEqual([])
  })
})

describe('estimate', () => {
  it('prices each action and a whole site', () => {
    const pricing = { inputUsdPer1M: 3, outputUsdPer1M: 15 }
    const estimate = estimateSiteAi(pricing, 1.5)
    const plan =
      ((SITE_AI_TYPICAL_USAGE.plan.inputTokens * 3 +
        SITE_AI_TYPICAL_USAGE.plan.outputTokens * 15) /
        1_000_000) *
      1.5
    expect(estimate.planUsd).toBe(Math.ceil(plan * 1000) / 1000)
    expect(estimate.pageUsd).toBeGreaterThan(estimate.planUsd)
    expect(estimate.sectionUsd).toBeGreaterThan(0)
    expect(estimate.rewriteUsd).toBeGreaterThan(0)
    expect(estimate.imagesUsd).toBeGreaterThan(0)
    expect(estimateSiteAi(pricing).planUsd).toBeLessThanOrEqual(
      estimate.planUsd,
    )
    expect(estimateSiteGeneration({ planUsd: 0.01, pageUsd: 0.02 }, 3)).toBe(
      0.07,
    )
    expect(estimateSiteGeneration({ planUsd: 0.01, pageUsd: 0.02 }, 0)).toBe(
      0.03,
    )
  })
})

async function readAll(response: Response): Promise<string> {
  return new TextDecoder().decode(await response.arrayBuffer())
}

describe('siteAiSseResponse', () => {
  it('frames events and sets the stream headers', async () => {
    async function* events(): AsyncGenerator<SiteAiEvent> {
      yield {
        type: 'step',
        id: 'theme',
        label: 'Criando tema…',
        status: 'running',
      }
      yield { type: 'error', code: 'X', message: 'y' }
    }
    const response = siteAiSseResponse(events())
    expect(response.headers.get('Content-Type')).toContain('text/event-stream')
    expect(response.headers.get('X-Accel-Buffering')).toBe('no')
    const body = await readAll(response)
    expect(body).toBe(
      encodeSiteAiEvent({
        type: 'step',
        id: 'theme',
        label: 'Criando tema…',
        status: 'running',
      }) + encodeSiteAiEvent({ type: 'error', code: 'X', message: 'y' }),
    )
    expect(body.startsWith('event: step\ndata: {')).toBe(true)
  })

  it('sends heartbeats and turns a crash into an error event', async () => {
    const onError = vi.fn()
    async function* events(): AsyncGenerator<SiteAiEvent> {
      await new Promise((resolve) => setTimeout(resolve, 30))
      throw new Error('boom')
    }
    const body = await readAll(siteAiSseResponse(events(), onError, 5))
    expect(body).toContain(': ping\n\n')
    expect(body).toContain('"code":"INTERNAL_SERVER_ERROR"')
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
    expect(SITE_AI_HEARTBEAT_MS).toBe(15_000)
  })

  it('stops writing when the client goes away', async () => {
    let resume: () => void = () => undefined
    const finished = vi.fn()
    async function* events(): AsyncGenerator<SiteAiEvent> {
      yield { type: 'steps', steps: [] }
      await new Promise<void>((resolve) => {
        resume = resolve
      })
      yield { type: 'steps', steps: [] }
      finished()
    }
    const response = siteAiSseResponse(events())
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    await reader.read()
    await reader.cancel()
    resume()
    await vi.waitFor(() => expect(finished).toHaveBeenCalled())
  })
})
