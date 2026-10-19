import { describe, expect, it } from 'vitest'
import {
  buildCrmInsights,
  buildSdInsights,
  buildZapInsights,
  PROACTIVE_RULES,
  type SdBreachSignal,
  staleDealsOf,
  type ZapConversationSignal,
} from '@/src/lib/ai/proactive/rules'
import {
  scopeFromSnapshot,
  type WhatsAppTeamSnapshot,
} from '@/src/lib/whatsapp/conversation-scope'

// 12:00 in São Paulo (UTC-3).
const NOW = new Date('2026-10-18T15:00:00.000Z')
const TZ = 'America/Sao_Paulo'
const MIN = 60_000
const DAY = 86_400_000

/** `Intl` puts a no-break space after "R$". */
function plain(text: string): string {
  return text.replace(/\u00a0/g, ' ')
}

function breach(overrides: Partial<SdBreachSignal> = {}): SdBreachSignal {
  return {
    ticketId: 't1',
    number: 123,
    code: 'INC-000123',
    title: 'Servidor de e-mail fora do ar',
    departmentId: 'd1',
    departmentName: 'N1',
    assigneeId: 'agent',
    breachEtaAt: new Date(NOW.getTime() + 90 * MIN),
    score: 82,
    ...overrides,
  }
}

describe('buildSdInsights', () => {
  it('gives the assignee their own tickets and the lead the department queue', () => {
    const drafts = buildSdInsights({
      slug: 'acme',
      timeZone: TZ,
      now: NOW,
      signals: [
        breach(),
        breach({
          ticketId: 't2',
          number: 124,
          code: 'INC-000124',
          assigneeId: null,
          breachEtaAt: new Date(NOW.getTime() + 180 * MIN),
          score: 60,
        }),
      ],
      viewers: [
        { userId: 'agent', isAdmin: false, leadDepartmentIds: [] },
        { userId: 'lead', isAdmin: false, leadDepartmentIds: ['d1'] },
        { userId: 'other', isAdmin: false, leadDepartmentIds: ['d9'] },
      ],
    })

    expect(drafts.map((d) => [d.userId, d.dedupeKey])).toEqual([
      ['agent', 'sd-breach:assignee:agent'],
      ['lead', 'sd-breach:dept:d1'],
    ])
    const [own, queue] = drafts
    expect(own.title).toBe('O chamado INC-000123 deve estourar o SLA às 13:30')
    expect(own.href).toBe('/acme/servicedesk/tickets/123')
    expect(own.severity).toBe('WARNING')
    expect(queue.title).toBe('A fila de N1 deve estourar o SLA às 13:30')
    expect(queue.body).toBe(
      '2 chamados com previsão de estouro até 15:00, 1 sem responsável. O primeiro é INC-000123: Servidor de e-mail fora do ar.',
    )
    expect(queue.facts).toEqual([
      { label: 'Chamados', value: '2' },
      { label: 'Primeiro estouro', value: '13:30' },
      { label: 'Sem responsável', value: '1' },
    ])
    expect(queue.href).toBe('/acme/servicedesk/risk')
    expect(queue.prompt).toContain('fila de N1')
  })

  it('summarizes several own tickets and marks a breach within the hour as critical', () => {
    const [own] = buildSdInsights({
      slug: 'acme',
      timeZone: TZ,
      now: NOW,
      signals: [
        breach({ breachEtaAt: new Date(NOW.getTime() + 30 * MIN) }),
        breach({
          ticketId: 't2',
          code: 'INC-000200',
          breachEtaAt: new Date(NOW.getTime() + 13 * 60 * MIN),
        }),
      ],
      viewers: [{ userId: 'agent', isAdmin: false, leadDepartmentIds: [] }],
    })
    expect(own.severity).toBe('CRITICAL')
    expect(own.title).toBe(
      `2 chamados seus devem estourar o SLA nas próximas ${PROACTIVE_RULES.sdForecastWindowHours} h`,
    )
    // 01:00 the next local day.
    expect(own.body).toBe(
      'O primeiro, INC-000123, vence às 12:30; o último, amanhã às 01:00. Previsão do risco preditivo se nada mudar.',
    )
    expect(own.href).toBe('/acme/servicedesk/risk')
  })

  it('sends tickets without a department only to the ServiceDesk admins', () => {
    const drafts = buildSdInsights({
      slug: 'acme',
      timeZone: TZ,
      now: NOW,
      signals: [
        breach({ departmentId: null, departmentName: null, assigneeId: null }),
      ],
      viewers: [
        { userId: 'admin', isAdmin: true, leadDepartmentIds: [] },
        { userId: 'lead', isAdmin: false, leadDepartmentIds: ['d1'] },
      ],
    })
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      userId: 'admin',
      dedupeKey: 'sd-breach:dept:none',
      title: 'Chamados sem departamento devem estourar o SLA às 13:30',
    })
    expect(drafts[0].prompt).toContain('sem departamento')
  })

  it('returns nothing without signals', () => {
    expect(
      buildSdInsights({
        slug: 'acme',
        timeZone: TZ,
        now: NOW,
        signals: [],
        viewers: [{ userId: 'admin', isAdmin: true, leadDepartmentIds: [] }],
      }),
    ).toEqual([])
  })

  it('falls back to a generic department name', () => {
    const [draft] = buildSdInsights({
      slug: 'acme',
      timeZone: TZ,
      now: NOW,
      signals: [breach({ departmentName: null, assigneeId: null })],
      viewers: [{ userId: 'admin', isAdmin: true, leadDepartmentIds: [] }],
    })
    expect(draft.title).toBe(
      'A fila de departamento deve estourar o SLA às 13:30',
    )
  })
})

const DEAL = {
  name: 'Acme — Renovação',
  amount: 1000,
  stageId: 's1',
  stageName: 'Proposta',
  ownerId: 'seller',
}

describe('staleDealsOf', () => {
  it('uses the latest of the timeline activity and the last edit', () => {
    const stale = staleDealsOf(
      [
        { ...DEAL, id: 'old', updatedAt: new Date(NOW.getTime() - 30 * DAY) },
        {
          ...DEAL,
          id: 'touched',
          updatedAt: new Date(NOW.getTime() - 30 * DAY),
        },
        {
          ...DEAL,
          id: 'edited',
          amount: null,
          updatedAt: new Date(NOW.getTime() - 12 * DAY),
        },
        { ...DEAL, id: 'fresh', updatedAt: new Date(NOW.getTime() - DAY) },
      ],
      new Map([
        ['touched', new Date(NOW.getTime() - 2 * DAY)],
        ['edited', new Date(NOW.getTime() - 40 * DAY)],
      ]),
      NOW,
    )
    expect(stale.map((d) => [d.id, d.idleDays])).toEqual([
      ['old', 30],
      ['edited', 12],
    ])
  })

  it('breaks ties on idle days by amount', () => {
    const at = new Date(NOW.getTime() - 15 * DAY)
    const stale = staleDealsOf(
      [
        { ...DEAL, id: 'small', amount: 10, updatedAt: at },
        { ...DEAL, id: 'big', amount: 999, updatedAt: at },
        { ...DEAL, id: 'none', amount: null, updatedAt: at },
      ],
      new Map(),
      NOW,
      10,
    )
    expect(stale.map((d) => d.id)).toEqual(['big', 'small', 'none'])
  })
})

function stale(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Negócio ${id}`,
    amount: 1000,
    stageId: 's1',
    stageName: 'Proposta',
    ownerId: 'seller',
    idleDays: 20,
    ...overrides,
  }
}

describe('buildCrmInsights', () => {
  it('gives the owner their deals and the admins the total, stage and gap', () => {
    const drafts = buildCrmInsights({
      slug: 'acme',
      deals: [
        stale('a', { idleDays: 32 }),
        stale('b'),
        stale('c', { ownerId: null }),
        stale('d', { stageId: 's2', stageName: 'Contato', ownerId: 'other' }),
      ],
      forecast: {
        periodKey: '2026-10',
        periodLabel: 'outubro de 2026',
        targetAmount: 100_000,
        weightedAmount: 60_000,
        wonAmount: 40_000,
      },
      viewers: [
        { userId: 'seller', isPrivileged: false },
        { userId: 'admin', isPrivileged: true },
      ],
    })

    expect(drafts.map((d) => [d.userId, d.dedupeKey])).toEqual([
      ['seller', 'crm-stale:owner:seller'],
      ['admin', 'crm-stale:all'],
      ['admin', 'crm-stage:s1'],
      ['admin', 'crm-forecast:2026-10'],
    ])
    const [own, all, stage, gap] = drafts
    expect(own.title).toBe(
      '2 oportunidades suas sem contato há 10 dias ou mais',
    )
    expect(plain(own.body)).toBe(
      'Somam R$ 2.000,00. A mais parada, Negócio a, está sem atividade há 32 dias.',
    )
    expect(own.severity).toBe('INFO')
    expect(all.title).toBe('4 oportunidades sem contato há 10 dias ou mais')
    expect(all.body).toContain('1 está sem responsável')
    expect(stage.title).toBe(
      'A etapa Proposta concentra 3 oportunidades paradas',
    )
    expect(plain(stage.body)).toBe(
      '3 de 4 oportunidades sem contato há 10 dias ou mais estão nessa etapa, somando R$ 3.000,00.',
    )
    expect(gap.title).toBe(
      'A previsão de outubro de 2026 está 40% abaixo da meta',
    )
    expect(gap.severity).toBe('WARNING')
    expect(plain(gap.body)).toBe(
      'Previsão ponderada de R$ 60.000,00 para uma meta de R$ 100.000,00: faltam R$ 40.000,00. Já ganho no período: R$ 40.000,00.',
    )
    expect(gap.href).toBe('/acme/crm/forecast')
  })

  it('links a single deal and uses the singular', () => {
    const [own] = buildCrmInsights({
      slug: 'acme',
      deals: [stale('a')],
      forecast: null,
      viewers: [{ userId: 'seller', isPrivileged: false }],
    })
    expect(own.title).toBe('1 oportunidade sua sem contato há 10 dias ou mais')
    expect(plain(own.body).startsWith('Vale R$ 1.000,00.')).toBe(true)
    expect(own.href).toBe('/acme/crm/opportunities?record=a')
  })

  it('warns from five stale deals and ignores small gaps or no quota', () => {
    const deals = ['a', 'b', 'c', 'd', 'e'].map((id, index) =>
      stale(id, { stageId: `s${index}` }),
    )
    const viewers = [{ userId: 'admin', isPrivileged: true }]
    const near = buildCrmInsights({
      slug: 'acme',
      deals,
      forecast: {
        periodKey: '2026-10',
        periodLabel: 'outubro de 2026',
        targetAmount: 100_000,
        weightedAmount: 95_000,
        wonAmount: 0,
      },
      viewers,
    })
    expect(near.map((d) => d.dedupeKey)).toEqual(['crm-stale:all'])
    expect(near[0].severity).toBe('WARNING')

    const noQuota = buildCrmInsights({
      slug: 'acme',
      deals: [],
      forecast: {
        periodKey: '2026-10',
        periodLabel: 'outubro de 2026',
        targetAmount: null,
        weightedAmount: 0,
        wonAmount: 0,
      },
      viewers,
    })
    expect(noQuota).toEqual([])
  })

  it('reports a mild gap as informative', () => {
    const [gap] = buildCrmInsights({
      slug: 'acme',
      deals: [],
      forecast: {
        periodKey: '2026-10',
        periodLabel: 'outubro de 2026',
        targetAmount: 100_000,
        weightedAmount: 80_000,
        wonAmount: 10_000,
      },
      viewers: [{ userId: 'admin', isPrivileged: true }],
    })
    expect(gap).toMatchObject({ kind: 'CRM_FORECAST_GAP', severity: 'INFO' })
  })
})

function conversation(
  overrides: Partial<ZapConversationSignal> = {},
): ZapConversationSignal {
  return {
    id: 'c1',
    contactName: 'Maria',
    assignedUserId: null,
    teamId: null,
    since: new Date(NOW.getTime() - 45 * MIN),
    score: null,
    ...overrides,
  }
}

const TEAMS: WhatsAppTeamSnapshot[] = [
  {
    id: 'team-a',
    members: [
      { userId: 'leader', role: 'LEADER' },
      { userId: 'agent', role: 'AGENT' },
    ],
  },
]

const owner = {
  userId: 'owner',
  scope: scopeFromSnapshot('owner', 'OWNER', TEAMS),
}
const leader = {
  userId: 'leader',
  scope: scopeFromSnapshot('leader', 'MEMBER', TEAMS),
}
const agent = {
  userId: 'agent',
  scope: scopeFromSnapshot('agent', 'MEMBER', TEAMS),
}
const outsider = {
  userId: 'outsider',
  scope: scopeFromSnapshot('outsider', 'MEMBER', TEAMS),
}

describe('buildZapInsights', () => {
  it('counts the waiting queue each viewer can see', () => {
    const drafts = buildZapInsights({
      slug: 'acme',
      now: NOW,
      waiting: [
        conversation(),
        conversation({
          id: 'c2',
          teamId: 'team-a',
          contactName: null,
          since: new Date(NOW.getTime() - 150 * MIN),
        }),
        conversation({ id: 'fresh', since: new Date(NOW.getTime() - 5 * MIN) }),
      ],
      negative: [],
      threshold: -0.3,
      viewers: [owner, agent, outsider],
    })

    expect(drafts.map((d) => [d.userId, d.title])).toEqual([
      ['owner', '2 conversas aguardam atendente há mais de 30 min'],
      ['agent', '2 conversas aguardam atendente há mais de 30 min'],
      ['outsider', '1 conversa aguarda atendente há mais de 30 min'],
    ])
    expect(drafts[0]).toMatchObject({
      severity: 'CRITICAL',
      body: 'A mais antiga, de um contato, espera há 2 h 30 min.',
      href: '/acme/zap',
    })
    expect(drafts[2]).toMatchObject({
      severity: 'WARNING',
      body: 'A mais antiga, de Maria, espera há 45 min.',
      href: '/acme/zap?conversa=c1',
    })
  })

  it('tells who follows the conversation about a sentiment drop, worst first', () => {
    const drafts = buildZapInsights({
      slug: 'acme',
      now: NOW,
      waiting: [],
      negative: [
        conversation({
          id: 'mild',
          assignedUserId: 'agent',
          teamId: 'team-a',
          score: -0.4,
        }),
        conversation({
          id: 'bad',
          contactName: 'João',
          assignedUserId: 'agent',
          teamId: 'team-a',
          score: -0.8,
        }),
        conversation({ id: 'queue', score: -0.5 }),
        conversation({ id: 'ok', assignedUserId: 'agent', score: 0.2 }),
      ],
      threshold: -0.3,
      viewers: [owner, leader, agent, outsider],
    })

    const byUser = (id: string) =>
      drafts.filter((d) => d.userId === id).map((d) => d.dedupeKey)
    expect(byUser('owner')).toEqual([
      'zap-sentiment:bad',
      'zap-sentiment:queue',
      'zap-sentiment:mild',
    ])
    expect(byUser('leader')).toEqual([
      'zap-sentiment:bad',
      'zap-sentiment:mild',
    ])
    expect(byUser('agent')).toEqual(['zap-sentiment:bad', 'zap-sentiment:mild'])
    // Sees the general queue, but does not follow it.
    expect(byUser('outsider')).toEqual([])

    const worst = drafts.find((d) => d.userId === 'agent')
    expect(worst).toMatchObject({
      title: 'O sentimento de João caiu',
      severity: 'CRITICAL',
      body: 'Média de -0,80 nas últimas mensagens (o alerta do workspace começa em -0,30, numa escala de -1 a 1).',
      href: '/acme/zap?conversa=bad',
    })
  })

  it('caps the sentiment insights per person', () => {
    const negative = Array.from({ length: 8 }, (_, index) =>
      conversation({ id: `n${index}`, score: -0.5 - index / 100 }),
    )
    const drafts = buildZapInsights({
      slug: 'acme',
      now: NOW,
      waiting: [],
      negative,
      threshold: -0.3,
      viewers: [owner],
    })
    expect(drafts).toHaveLength(PROACTIVE_RULES.zapSentimentMaxPerUser)
  })

  it('lets a leader follow conversations of the agents they lead', () => {
    const drafts = buildZapInsights({
      slug: 'acme',
      now: NOW,
      waiting: [],
      negative: [conversation({ assignedUserId: 'agent', score: -0.5 })],
      threshold: -0.3,
      viewers: [leader],
    })
    expect(drafts.map((d) => d.dedupeKey)).toEqual(['zap-sentiment:c1'])
  })
})
