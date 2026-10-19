import { describe, expect, it } from 'vitest'
import {
  AI_DIGEST_INTRO_MAX,
  type AiDigestItem,
  allowedDigestNumbers,
  cleanDigestIntro,
  digestModuleCounts,
  digestPromptInput,
  fallbackDigestIntro,
  isDigestIntroGrounded,
  numbersIn,
  sortDigestItems,
} from '@/src/lib/ai/proactive/digest'

const ITEMS: AiDigestItem[] = [
  {
    module: 'CRM',
    severity: 'INFO',
    title: '4 oportunidades suas sem contato há 10 dias ou mais',
    body: 'Somam R$ 120.000,00. A mais parada, Acme, está sem atividade há 32 dias.',
    facts: [
      { label: 'Oportunidades', value: '4' },
      { label: 'Valor', value: 'R$ 120.000,00' },
    ],
    href: '/acme/crm/opportunities',
  },
  {
    module: 'SERVICE_DESK',
    severity: 'CRITICAL',
    title: 'A fila de N1 deve estourar o SLA às 15:00',
    body: '3 chamados com previsão de estouro até 17:30.',
    facts: [{ label: 'Chamados', value: '3' }],
    href: '/acme/servicedesk/risk',
  },
  {
    module: 'CRM',
    severity: 'WARNING',
    title: 'A previsão de outubro de 2026 está 40% abaixo da meta',
    body: 'Faltam R$ 40.000,00.',
    facts: [],
    href: null,
  },
]

describe('digest ordering and counts', () => {
  it('sorts by severity, then module', () => {
    expect(sortDigestItems(ITEMS).map((item) => item.severity)).toEqual([
      'CRITICAL',
      'WARNING',
      'INFO',
    ])
    const sameSeverity = sortDigestItems([
      { ...ITEMS[0], module: 'COMMUNICATION' },
      { ...ITEMS[0], module: 'SERVICE_DESK' },
      { ...ITEMS[0], module: 'CRM' },
    ])
    expect(sameSeverity.map((item) => item.module)).toEqual([
      'SERVICE_DESK',
      'CRM',
      'COMMUNICATION',
    ])
  })

  it('counts per module in product order, skipping empty modules', () => {
    expect(digestModuleCounts(ITEMS)).toEqual([
      { module: 'SERVICE_DESK', count: 1 },
      { module: 'CRM', count: 2 },
    ])
  })
})

describe('fallbackDigestIntro', () => {
  it('states the counts and the most urgent insight, from the data only', () => {
    expect(fallbackDigestIntro(ITEMS)).toBe(
      'Você tem 3 alertas hoje: 1 no ServiceDesk e 2 no CRM. O mais urgente: A fila de N1 deve estourar o SLA às 15:00.',
    )
  })

  it('handles one module and three modules', () => {
    expect(fallbackDigestIntro([ITEMS[1]])).toBe(
      'Você tem 1 alerta hoje: 1 no ServiceDesk. O mais urgente: A fila de N1 deve estourar o SLA às 15:00.',
    )
    const three = fallbackDigestIntro([
      ...ITEMS,
      { ...ITEMS[0], module: 'COMMUNICATION', title: 'Conversas aguardando' },
    ])
    expect(three).toContain('1 no ServiceDesk, 2 no CRM e 1 na Comunicação')
  })

  it('never produces a number the guard would reject', () => {
    expect(isDigestIntroGrounded(fallbackDigestIntro(ITEMS), ITEMS)).toBe(true)
  })

  it('degrades to the head sentence with no items', () => {
    expect(fallbackDigestIntro([])).toBe('Você tem 0 alertas hoje.')
  })
})

describe('number guard (no hallucinated numbers)', () => {
  it('normalizes separators and leading zeros', () => {
    expect(numbersIn('R$ 120.000,00 em 05 dias às 15:00')).toEqual([
      '12000000',
      '5',
      '15',
      '0',
    ])
    expect(numbersIn('sem números')).toEqual([])
  })

  it('allows the counts, the texts and the facts', () => {
    const allowed = allowedDigestNumbers(ITEMS)
    for (const n of [
      '3',
      '1',
      '2',
      '4',
      '10',
      '32',
      '12000000',
      '40',
      '2026',
    ]) {
      expect(allowed.has(n)).toBe(true)
    }
  })

  it('accepts an intro that only cites numbers from the data', () => {
    expect(
      isDigestIntroGrounded(
        'Comece pela fila de N1, que deve estourar o SLA às 15:00: são 3 chamados. No CRM, 4 oportunidades somam R$ 120.000,00.',
        ITEMS,
      ),
    ).toBe(true)
    expect(isDigestIntroGrounded('Comece pela fila de N1.', ITEMS)).toBe(true)
  })

  it('rejects an intro with an invented, summed or rounded number', () => {
    // 3 + 4 = 7: a sum the data never stated.
    expect(
      isDigestIntroGrounded('Hoje são 7 pendências no total.', ITEMS),
    ).toBe(false)
    // Rounded money.
    expect(
      isDigestIntroGrounded('As oportunidades somam R$ 120 mil.', ITEMS),
    ).toBe(false)
    // Wrong clock time.
    expect(isDigestIntroGrounded('A fila estoura às 16:00.', ITEMS)).toBe(false)
  })
})

describe('cleanDigestIntro and prompt input', () => {
  it('flattens, strips Markdown and caps the length', () => {
    expect(cleanDigestIntro('  **Atenção**:\n  a fila   _N1_  ')).toBe(
      'Atenção: a fila N1',
    )
    const long = cleanDigestIntro('a'.repeat(AI_DIGEST_INTRO_MAX + 50))
    expect(long).toHaveLength(AI_DIGEST_INTRO_MAX)
    expect(long.endsWith('…')).toBe(true)
  })

  it('sends only module, severity, title and facts to the model', () => {
    const input = digestPromptInput(ITEMS)
    expect(input.startsWith('Alertas de hoje (3):')).toBe(true)
    const payload = JSON.parse(input.slice(input.indexOf('\n') + 1))
    expect(payload[0]).toEqual({
      modulo: 'ServiceDesk',
      gravidade: 'CRITICAL',
      alerta: 'A fila de N1 deve estourar o SLA às 15:00',
      numeros: ['Chamados: 3'],
    })
    expect(input).not.toContain('/acme/')
  })
})
