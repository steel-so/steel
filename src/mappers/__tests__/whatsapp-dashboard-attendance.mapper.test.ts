import type {
  WhatsAppConversationEventKind,
  WhatsAppConversationEventSource,
} from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  createFakeWaDashboardAttendance,
  createFakeWaDashboardEvent,
  createFakeWaDashboardSlaCycle,
  createFakeWaDashboardTeamMember,
} from '@/src/__tests__/factories/whatsapp-dashboard-attendance.factory'
import type { WaSlaCycleData } from '@/src/repositories/whatsapp-dashboard-attendance.repository'
import {
  toWaAttendanceRows,
  toWaConversationEventRows,
  toWaSlaCycleRows,
  toWaTeamMemberRows,
  WA_EVENT_KIND_LABELS,
  WA_EVENT_SOURCE_LABELS,
  waSentimentBandLabel,
} from '../whatsapp-dashboard-attendance.mapper'

const T0 = new Date('2026-11-17T12:00:00.000Z')
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000)

describe('waSentimentBandLabel', () => {
  it('should band the score with the thresholds of the widget engine', () => {
    expect(waSentimentBandLabel(null)).toBe('Sem classificação')
    expect(waSentimentBandLabel(0.2)).toBe('Positivo')
    expect(waSentimentBandLabel(0.9)).toBe('Positivo')
    expect(waSentimentBandLabel(-0.2)).toBe('Negativo')
    expect(waSentimentBandLabel(-1)).toBe('Negativo')
    expect(waSentimentBandLabel(0)).toBe('Neutro')
    expect(waSentimentBandLabel(0.19)).toBe('Neutro')
  })
})

describe('toWaAttendanceRows', () => {
  it('should flatten an open conversation without anyone on it', () => {
    const conversation = createFakeWaDashboardAttendance({
      status: 'NEW',
      lastMessageAt: null,
      lastInboundAt: null,
    })

    const [row] = toWaAttendanceRows([conversation], at(45))

    expect(row).toEqual({
      id: conversation.id,
      status: 'Nova',
      isOpen: true,
      connection: 'Principal',
      provider: 'Meta',
      contactName: 'Contato Teste',
      contactPhone: '+55 11 99999-0000',
      team: null,
      attendant: null,
      isUnassigned: true,
      aiCampaign: null,
      aiActive: false,
      aiHandoff: false,
      unreadCount: 0,
      isWaiting: false,
      firstResponseMinutes: null,
      durationMinutes: null,
      openMinutes: 45,
      waitingMinutes: null,
      avgResponseMinutes: null,
      outcome: null,
      closeStatus: [],
      closeReason: null,
      sentimentScore: null,
      sentimentLabel: 'Sem classificação',
      archived: false,
      createdAt: '2026-11-17T12:00:00.000Z',
      lastMessageAt: null,
      lastInboundAt: null,
      closedAt: null,
    })
  })

  it('should flatten a closed conversation with its classification', () => {
    const [row] = toWaAttendanceRows([
      {
        ...createFakeWaDashboardAttendance({
          status: 'CLOSED',
          assignedUserId: 'u1',
          assignedUser: { name: 'Ana' },
          team: { name: 'Retenção' },
          aiCampaign: { name: 'Santander' },
          connection: { label: 'Vendas', provider: 'ZAPI' },
          aiHandoff: true,
          // Unread messages of a closed conversation are not a wait.
          unreadCount: 3,
          avgSentimentScore: -0.5,
          archivedAt: at(200),
          createdAt: T0,
          firstInboundAt: at(1),
          firstResponseAt: at(8),
          closedAt: at(90),
          closeReason: 'Venda concluída',
          closeOutcome: 'SUCCESS',
          closeStatusLabels: ['Venda realizada'],
        }),
        avgResponseSeconds: 240,
      },
    ])

    expect(row).toMatchObject({
      status: 'Encerrada',
      isOpen: false,
      connection: 'Vendas',
      provider: 'Z-API',
      team: 'Retenção',
      attendant: 'Ana',
      isUnassigned: false,
      aiCampaign: 'Santander',
      aiHandoff: true,
      unreadCount: 3,
      isWaiting: false,
      firstResponseMinutes: 7,
      durationMinutes: 90,
      openMinutes: null,
      waitingMinutes: null,
      avgResponseMinutes: 4,
      outcome: 'Deu certo',
      closeStatus: ['Venda realizada'],
      closeReason: 'Venda concluída',
      sentimentScore: -0.5,
      sentimentLabel: 'Negativo',
      archived: true,
      closedAt: at(90).toISOString(),
      lastMessageAt: '2026-11-17T12:30:00.000Z',
      lastInboundAt: '2026-11-17T12:30:00.000Z',
    })
  })

  it('should name the failure outcome and the widget provider', () => {
    const [row] = toWaAttendanceRows([
      createFakeWaDashboardAttendance({
        status: 'CLOSED',
        closeOutcome: 'FAILURE',
        connection: { label: 'Site', provider: 'WIDGET' },
        // Closed without `closedAt` (legacy row): no duration.
        closedAt: null,
      }),
    ])

    expect(row).toMatchObject({
      outcome: 'Não deu',
      provider: 'Widget',
      durationMinutes: null,
    })
  })

  it('should tell who is waiting for a person', () => {
    const waiting = (
      overrides: Parameters<typeof createFakeWaDashboardAttendance>[0],
    ) =>
      toWaAttendanceRows([createFakeWaDashboardAttendance(overrides)])[0]
        .isWaiting

    // The contact wrote in this attendance and nobody answered yet.
    expect(waiting({ firstInboundAt: at(1) })).toBe(true)
    // Answered and read: nobody is waiting.
    expect(waiting({ firstInboundAt: at(1), firstResponseAt: at(2) })).toBe(
      false,
    )
    // Answered before, but the contact wrote again.
    expect(
      waiting({
        firstInboundAt: at(1),
        firstResponseAt: at(2),
        unreadCount: 2,
      }),
    ).toBe(true)
    // Without SLA marks, unread messages are the signal.
    expect(waiting({ status: 'NEW', unreadCount: 1 })).toBe(true)
    // The AI is answering: the contact is not waiting for a person.
    expect(waiting({ aiActive: true, unreadCount: 4 })).toBe(false)
    expect(waiting({ aiActive: true, firstInboundAt: at(1) })).toBe(false)
    // Closed conversations never wait.
    expect(waiting({ status: 'CLOSED', firstInboundAt: at(1) })).toBe(false)
  })

  it('should ignore a first response dated before the first inbound', () => {
    const [row] = toWaAttendanceRows([
      createFakeWaDashboardAttendance({
        firstInboundAt: at(10),
        firstResponseAt: at(5),
      }),
    ])

    expect(row.firstResponseMinutes).toBeNull()
  })
})

describe('toWaConversationEventRows', () => {
  it('should flatten a classified close with the conversation context', () => {
    const event = createFakeWaDashboardEvent({
      kind: 'CLOSED',
      source: 'AGENT',
      reason: ' Cliente comprou ',
      closeOutcome: 'SUCCESS',
      closeStatusLabels: ['Venda realizada'],
      actorUser: { name: 'Ana' },
      conversation: {
        assignedUser: { name: 'Bia' },
        team: { name: 'Retenção' },
        aiCampaign: { name: 'Santander' },
        connection: { label: 'Vendas' },
      },
    })

    expect(toWaConversationEventRows([event])).toEqual([
      {
        id: event.id,
        kind: 'Conversa fechada',
        source: 'Atendente',
        actor: 'Ana',
        reason: 'Cliente comprou',
        outcome: 'Deu certo',
        closeStatus: ['Venda realizada'],
        team: 'Retenção',
        attendant: 'Bia',
        aiCampaign: 'Santander',
        connection: 'Vendas',
        createdAt: '2026-11-17T13:00:00.000Z',
      },
    ])
  })

  it('should answer nulls for an automatic event without context', () => {
    const [row] = toWaConversationEventRows([
      createFakeWaDashboardEvent({
        kind: 'REOPENED',
        source: 'CONTACT',
        closeOutcome: 'FAILURE',
      }),
    ])

    expect(row).toMatchObject({
      kind: 'Conversa reaberta',
      source: 'Contato',
      actor: null,
      reason: null,
      outcome: 'Não deu',
      closeStatus: [],
      team: null,
      attendant: null,
      aiCampaign: null,
      connection: 'Principal',
    })
  })

  it('should keep only the action label of an AI action', () => {
    const reasonOf = (reason: string | null) =>
      toWaConversationEventRows([
        createFakeWaDashboardEvent({
          kind: 'AI_ACTION',
          source: 'AI_CAMPAIGN',
          reason,
        }),
      ])[0].reason

    expect(reasonOf('Agendar visita: o João pediu para sexta')).toBe(
      'Agendar visita',
    )
    expect(reasonOf('Agendar visita')).toBe('Agendar visita')
    expect(reasonOf(': sem rótulo')).toBeNull()
    expect(reasonOf('   ')).toBeNull()
    expect(reasonOf(null)).toBeNull()
  })

  it('should keep the structured reasons and drop the free text ones', () => {
    const kept: WhatsAppConversationEventKind[] = [
      'CLOSED',
      'REOPENED',
      'BUTTON_CLICKED',
      'ASSIGNED',
      'TEAM_CHANGED',
      'SLA_BREACHED',
      'CHATBOT_HANDOFF',
      'AI_UNAVAILABLE',
    ]
    const dropped: WhatsAppConversationEventKind[] = [
      'SENTIMENT_ALERT',
      'AI_GUARDRAIL_HANDOFF',
      'PIX_PAID',
      'TRANSFER_SUMMARY',
    ]
    const reasonOf = (kind: WhatsAppConversationEventKind) =>
      toWaConversationEventRows([
        createFakeWaDashboardEvent({ kind, reason: 'Texto: do evento' }),
      ])[0].reason

    for (const kind of kept) expect(reasonOf(kind)).toBe('Texto: do evento')
    for (const kind of dropped) expect(reasonOf(kind)).toBeNull()
  })

  it('should have a pt-BR label for every kind and source', () => {
    const kinds = Object.keys(
      WA_EVENT_KIND_LABELS,
    ) as WhatsAppConversationEventKind[]
    const sources = Object.keys(
      WA_EVENT_SOURCE_LABELS,
    ) as WhatsAppConversationEventSource[]
    expect(kinds).toHaveLength(13)
    expect(sources).toHaveLength(14)

    for (const kind of kinds) {
      const [row] = toWaConversationEventRows([
        createFakeWaDashboardEvent({ kind }),
      ])
      expect(row.kind).toBe(WA_EVENT_KIND_LABELS[kind])
      expect(row.kind).not.toBe(kind)
    }
    for (const source of sources) {
      const [row] = toWaConversationEventRows([
        createFakeWaDashboardEvent({ source }),
      ])
      expect(row.source).toBe(WA_EVENT_SOURCE_LABELS[source])
    }
    expect(WA_EVENT_SOURCE_LABELS.DISTRIBUTION).toBe('Distribuição automática')
    expect(WA_EVENT_KIND_LABELS.SLA_BREACHED).toBe('SLA estourado')
  })
})

describe('toWaSlaCycleRows', () => {
  function dataOf(overrides: Partial<WaSlaCycleData>): WaSlaCycleData {
    return { cycles: [], policies: [], teams: [], agents: [], ...overrides }
  }
  const rowOf = (
    overrides: Parameters<typeof createFakeWaDashboardSlaCycle>[0],
    now: Date,
  ) =>
    toWaSlaCycleRows(
      dataOf({ cycles: [createFakeWaDashboardSlaCycle(overrides)] }),
      now,
    )[0]

  it('should flatten a running cycle that is on time', () => {
    const cycle = createFakeWaDashboardSlaCycle()

    const [row] = toWaSlaCycleRows(dataOf({ cycles: [cycle] }), at(5))

    expect(row).toEqual({
      id: cycle.id,
      policy: 'Política removida',
      team: null,
      attendant: null,
      connection: 'Principal',
      aiCampaign: null,
      isOpen: true,
      businessHoursOnly: false,
      firstResponseState: 'No prazo',
      resolutionState: 'No prazo',
      firstResponseBreached: false,
      resolutionBreached: false,
      slaBreached: false,
      slaAtRisk: false,
      firstResponseMetPct: null,
      resolutionMetPct: null,
      firstResponseTargetMinutes: 15,
      resolutionTargetMinutes: 60,
      firstResponseMinutes: null,
      resolutionMinutes: null,
      startedAt: '2026-11-17T12:00:00.000Z',
      firstResponseDueAt: '2026-11-17T12:15:00.000Z',
      firstResponseAt: null,
      resolutionDueAt: '2026-11-17T13:00:00.000Z',
      resolvedAt: null,
      createdAt: '2026-11-17T12:00:00.000Z',
    })
  })

  it('should name the policy, the team and the attendant', () => {
    const rows = toWaSlaCycleRows(
      dataOf({
        cycles: [
          createFakeWaDashboardSlaCycle({
            policyId: 'p-default',
            teamId: 't1',
            agentUserId: 'u1',
            businessHoursOnly: true,
            conversation: {
              aiCampaign: { name: 'Santander' },
              connection: { label: 'Vendas' },
            },
          }),
          createFakeWaDashboardSlaCycle({
            policyId: 'p-team',
            teamId: 't-gone',
            agentUserId: 'u-gone',
          }),
          createFakeWaDashboardSlaCycle({ policyId: 'p-orphan' }),
          createFakeWaDashboardSlaCycle({ policyId: 'p-gone' }),
        ],
        policies: [
          { id: 'p-default', teamId: null },
          { id: 'p-team', teamId: 't1' },
          { id: 'p-orphan', teamId: 't-gone' },
        ],
        teams: [{ id: 't1', name: 'Retenção' }],
        agents: [{ id: 'u1', name: 'Ana' }],
      }),
      at(5),
    )

    expect(rows[0]).toMatchObject({
      policy: 'Padrão',
      team: 'Retenção',
      attendant: 'Ana',
      connection: 'Vendas',
      aiCampaign: 'Santander',
      businessHoursOnly: true,
    })
    expect(rows[1]).toMatchObject({
      policy: 'Equipe Retenção',
      team: 'Equipe removida',
      attendant: null,
    })
    expect(rows[2].policy).toBe('Equipe removida')
    expect(rows[3].policy).toBe('Política removida')
  })

  it('should tell a first response at risk from a breached one', () => {
    const atRisk = rowOf({}, at(13))
    expect(atRisk).toMatchObject({
      firstResponseState: 'Em risco',
      firstResponseBreached: false,
      slaAtRisk: true,
      slaBreached: false,
      firstResponseMetPct: null,
    })

    const breached = rowOf({}, at(15))
    expect(breached).toMatchObject({
      firstResponseState: 'Estourado',
      firstResponseBreached: true,
      slaBreached: true,
      slaAtRisk: false,
      firstResponseMetPct: 0,
    })
  })

  it('should evaluate an answered first response by its deadline', () => {
    const met = rowOf(
      { firstResponseAt: at(15), firstResponseSeconds: 290 },
      at(20),
    )
    expect(met).toMatchObject({
      firstResponseState: 'Cumprido',
      firstResponseMetPct: 100,
      firstResponseBreached: false,
      // Counted seconds win over the wall clock (business time).
      firstResponseMinutes: 5,
      firstResponseAt: at(15).toISOString(),
    })

    const late = rowOf({ firstResponseAt: at(16) }, at(20))
    expect(late).toMatchObject({
      firstResponseState: 'Estourado',
      firstResponseMetPct: 0,
      firstResponseBreached: true,
      firstResponseMinutes: 16,
    })
  })

  it('should not evaluate a first response closed before the deadline', () => {
    const early = rowOf({ resolvedAt: at(10) }, at(30))
    expect(early).toMatchObject({
      isOpen: false,
      firstResponseState: 'Não avaliado',
      firstResponseMetPct: null,
      firstResponseBreached: false,
      resolutionState: 'Cumprido',
      resolutionMetPct: 100,
      resolutionMinutes: 10,
      slaBreached: false,
      resolvedAt: at(10).toISOString(),
    })

    const lateClose = rowOf({ resolvedAt: at(15) }, at(30))
    expect(lateClose).toMatchObject({
      firstResponseState: 'Estourado',
      firstResponseMetPct: 0,
    })
  })

  it('should evaluate the resolution target', () => {
    const answered = { firstResponseAt: at(3), firstResponseSeconds: 180 }

    expect(rowOf(answered, at(50))).toMatchObject({
      resolutionState: 'Em risco',
      slaAtRisk: true,
      resolutionMetPct: null,
    })
    expect(rowOf(answered, at(60))).toMatchObject({
      resolutionState: 'Estourado',
      resolutionBreached: true,
      slaBreached: true,
      slaAtRisk: false,
      resolutionMetPct: 0,
    })
    expect(rowOf({ ...answered, resolvedAt: at(61) }, at(90))).toMatchObject({
      isOpen: false,
      resolutionState: 'Estourado',
      resolutionMetPct: 0,
      resolutionMinutes: 61,
      slaAtRisk: false,
    })
    // A deadline without a warning instant is never "at risk".
    expect(
      rowOf({ ...answered, resolutionWarnAt: null }, at(50)),
    ).toMatchObject({ resolutionState: 'No prazo', slaAtRisk: false })
  })

  it('should answer "Sem meta" when the policy does not track resolution', () => {
    const row = rowOf(
      {
        resolutionMinutes: null,
        resolutionDueAt: null,
        resolutionWarnAt: null,
        resolvedAt: at(500),
        firstResponseAt: at(2),
      },
      at(600),
    )

    expect(row).toMatchObject({
      resolutionState: 'Sem meta',
      resolutionMetPct: null,
      resolutionBreached: false,
      resolutionTargetMinutes: null,
      resolutionDueAt: null,
      resolutionMinutes: 500,
      firstResponseState: 'Cumprido',
    })
  })
})

describe('toWaTeamMemberRows', () => {
  it('should flatten the members with presence and open conversations', () => {
    const ana = createFakeWaDashboardTeamMember({
      teamId: 't1',
      userId: 'u1',
      role: 'LEADER',
    })
    const bia = createFakeWaDashboardTeamMember({
      teamId: 't1',
      userId: 'u2',
      user: { name: 'Bia' },
    })
    const anaElsewhere = createFakeWaDashboardTeamMember({
      teamId: 't2',
      userId: 'u1',
      team: { name: 'Vendas' },
    })

    const rows = toWaTeamMemberRows({
      members: [ana, bia, anaElsewhere],
      presences: [
        {
          userId: 'u2',
          status: 'AWAY',
          lastAssignedAt: new Date('2026-11-17T10:00:00.000Z'),
          updatedAt: new Date('2026-11-17T11:00:00.000Z'),
        },
        {
          userId: 'u1',
          status: 'AVAILABLE',
          lastAssignedAt: null,
          updatedAt: new Date('2026-11-17T09:00:00.000Z'),
        },
      ],
      openCounts: [
        { teamId: 't1', userId: 'u1', count: 4 },
        { teamId: 't2', userId: 'u1', count: 1 },
        // Conversations of someone who left the team count for nobody.
        { teamId: 't2', userId: 'u2', count: 9 },
      ],
    })

    expect(rows).toEqual([
      {
        id: ana.id,
        team: 'Retenção',
        attendant: 'Ana',
        role: 'Líder',
        presence: 'Disponível',
        isOnline: true,
        openConversations: 4,
        lastAssignedAt: null,
        presenceChangedAt: '2026-11-17T09:00:00.000Z',
        createdAt: '2026-10-01T12:00:00.000Z',
      },
      {
        id: bia.id,
        team: 'Retenção',
        attendant: 'Bia',
        role: 'Agente',
        presence: 'Ausente',
        isOnline: false,
        openConversations: 0,
        lastAssignedAt: '2026-11-17T10:00:00.000Z',
        presenceChangedAt: '2026-11-17T11:00:00.000Z',
        createdAt: '2026-10-01T12:00:00.000Z',
      },
      expect.objectContaining({
        id: anaElsewhere.id,
        team: 'Vendas',
        openConversations: 1,
      }),
    ])
  })

  it('should treat a member without a presence row as available', () => {
    const [row] = toWaTeamMemberRows({
      members: [createFakeWaDashboardTeamMember()],
      presences: [],
      openCounts: [],
    })

    expect(row).toMatchObject({
      presence: 'Disponível',
      isOnline: true,
      openConversations: 0,
      lastAssignedAt: null,
      presenceChangedAt: null,
    })
  })
})

describe('toWaAttendanceRows response times', () => {
  it('should age an open conversation and time who is waiting', () => {
    const [row] = toWaAttendanceRows(
      [
        createFakeWaDashboardAttendance({
          status: 'IN_PROGRESS',
          unreadCount: 2,
          lastInboundAt: at(30),
        }),
      ],
      at(50),
    )

    expect(row).toMatchObject({
      isWaiting: true,
      openMinutes: 50,
      waitingMinutes: 20,
    })
  })
})
