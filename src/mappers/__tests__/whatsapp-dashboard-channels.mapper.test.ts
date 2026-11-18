import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  createFakeWaDashboardAdReferral,
  createFakeWaDashboardAdSpend,
  createFakeWaDashboardAppointment,
  createFakeWaDashboardBoletoCharge,
  createFakeWaDashboardCall,
  createFakeWaDashboardChatbotSession,
  createFakeWaDashboardContact,
  createFakeWaDashboardFlowResponse,
  createFakeWaDashboardPixCharge,
  createFakeWaDashboardReferralConversation,
} from '@/src/__tests__/factories/whatsapp-dashboard-channels.factory'
import {
  toWaAdReferralRows,
  toWaAdSpendRows,
  toWaAppointmentRows,
  toWaCallRows,
  toWaChargeRows,
  toWaChatbotSessionRows,
  toWaContactRows,
  toWaFlowResponseRows,
} from '../whatsapp-dashboard-channels.mapper'

const NOW = new Date('2026-11-18T12:00:00.000Z')

describe('toWaCallRows', () => {
  it('should flatten an answered call with its conversation', () => {
    const [row] = toWaCallRows([
      createFakeWaDashboardCall({
        id: 'call1',
        recordingKey: 'ws/call1.mp3',
        sentiment: 'POSITIVE',
      }),
    ])

    expect(row).toEqual({
      id: 'call1',
      direction: 'Realizada',
      origin: 'Clique para ligar',
      status: 'Atendida',
      isAnswered: true,
      answeredPct: 100,
      durationSeconds: 90,
      durationMinutes: 1.5,
      ringSeconds: 20,
      attendant: 'Ana',
      team: 'Retenção',
      connection: 'Principal',
      hasRecording: true,
      isVoiceAgent: false,
      sentiment: 'Positivo',
      createdAt: '2026-11-17T12:00:00.000Z',
      answeredAt: '2026-11-17T12:00:20.000Z',
      endedAt: '2026-11-17T12:01:50.000Z',
    })
  })

  it('should answer nulls for a lost inbound call without a conversation', () => {
    const [row] = toWaCallRows([
      createFakeWaDashboardCall({
        status: 'NO_ANSWER',
        direction: 'INBOUND',
        source: 'WEBPHONE',
        voiceAgent: true,
        durationSeconds: null,
        answeredAt: null,
        endedAt: null,
        user: null,
        conversation: null,
      }),
    ])

    expect(row).toMatchObject({
      direction: 'Recebida',
      origin: 'Telefone no navegador',
      status: 'Não atendeu',
      isAnswered: false,
      answeredPct: 0,
      durationSeconds: null,
      durationMinutes: null,
      ringSeconds: null,
      attendant: null,
      team: null,
      connection: null,
      hasRecording: false,
      isVoiceAgent: true,
      sentiment: null,
      answeredAt: null,
      endedAt: null,
    })
  })

  it('should leave the answer rate empty while the call rings', () => {
    const rows = toWaCallRows([
      createFakeWaDashboardCall({ status: 'QUEUED', answeredAt: null }),
      createFakeWaDashboardCall({ status: 'DIALING', answeredAt: null }),
      createFakeWaDashboardCall({
        status: 'IN_PROGRESS',
        conversation: { team: null, connection: { label: 'Vendas' } },
      }),
    ])

    expect(rows.map((row) => row.answeredPct)).toEqual([null, null, 100])
    expect(rows[0].status).toBe('Chamando o ramal')
    expect(rows[2]).toMatchObject({ team: null, connection: 'Vendas' })
  })
})

describe('toWaChargeRows', () => {
  it('should merge Pix and boleto charges, newest first', () => {
    const rows = toWaChargeRows(
      {
        pixCharges: [
          createFakeWaDashboardPixCharge({
            id: 'pix1',
            status: 'PAID',
            createdById: 'u1',
            paidAmount: new Prisma.Decimal('150.50'),
            paidAt: new Date('2026-11-17T12:12:30.000Z'),
            createdAt: new Date('2026-11-17T12:00:00.000Z'),
          }),
        ],
        boletoCharges: [
          createFakeWaDashboardBoletoCharge({
            id: 'boleto1',
            createdById: 'u1',
            createdAt: new Date('2026-11-17T15:00:00.000Z'),
          }),
        ],
        users: [{ id: 'u1', name: 'Ana' }],
      },
      NOW,
      10,
    )

    expect(rows).toEqual([
      {
        id: 'boleto1',
        method: 'Boleto',
        status: 'Aguardando pagamento',
        isPaid: false,
        paidPct: null,
        amount: 300,
        paidAmount: null,
        attendant: 'Ana',
        createdByAi: false,
        minutesToPay: null,
        createdAt: '2026-11-17T15:00:00.000Z',
        paidAt: null,
        expiresAt: '2026-11-20T03:00:00.000Z',
      },
      {
        id: 'pix1',
        method: 'Pix',
        status: 'Pago',
        isPaid: true,
        paidPct: 100,
        amount: 150.5,
        paidAmount: 150.5,
        attendant: 'Ana',
        createdByAi: false,
        minutesToPay: 12.5,
        createdAt: '2026-11-17T12:00:00.000Z',
        paidAt: '2026-11-17T12:12:30.000Z',
        expiresAt: '2026-11-17T13:00:00.000Z',
      },
    ])
  })

  it('should read a pending charge past its deadline as expired', () => {
    const [pix, boleto] = toWaChargeRows(
      {
        pixCharges: [createFakeWaDashboardPixCharge()],
        boletoCharges: [
          createFakeWaDashboardBoletoCharge({
            dueAt: new Date('2026-11-18T03:00:00.000Z'),
            createdAt: new Date('2026-11-16T12:00:00.000Z'),
          }),
        ],
        users: [],
      },
      NOW,
      10,
    )

    expect(pix).toMatchObject({ status: 'Vencido', isPaid: false, paidPct: 0 })
    expect(boleto).toMatchObject({ method: 'Boleto', status: 'Vencido' })
  })

  it('should label the other statuses and name the AI as the creator', () => {
    const rows = toWaChargeRows(
      {
        pixCharges: [
          createFakeWaDashboardPixCharge({
            status: 'CANCELED',
            createdByAi: true,
          }),
          createFakeWaDashboardPixCharge({
            status: 'EXPIRED',
            createdById: 'gone',
          }),
        ],
        boletoCharges: [
          createFakeWaDashboardBoletoCharge({ status: 'REFUNDED' }),
        ],
        users: [],
      },
      NOW,
      10,
    )

    expect(rows.map((row) => row.status).sort()).toEqual([
      'Cancelado',
      'Estornado',
      'Vencido',
    ])
    expect(rows.every((row) => row.paidPct === 0)).toBe(true)
    expect(rows.find((row) => row.status === 'Cancelado')).toMatchObject({
      attendant: 'IA',
      createdByAi: true,
    })
    // A creator that no longer exists leaves the attendant empty.
    expect(
      rows.find((row) => row.status === 'Vencido' && row.method === 'Pix')
        ?.attendant,
    ).toBeNull()
  })

  it('should cut the merged list at the limit', () => {
    const rows = toWaChargeRows(
      {
        pixCharges: [
          createFakeWaDashboardPixCharge({ id: 'old', createdAt: new Date(0) }),
        ],
        boletoCharges: [createFakeWaDashboardBoletoCharge({ id: 'new' })],
        users: [],
      },
      NOW,
      1,
    )

    expect(rows.map((row) => row.id)).toEqual(['new'])
  })
})

describe('toWaAppointmentRows', () => {
  it('should flatten an upcoming appointment', () => {
    const [row] = toWaAppointmentRows(
      [createFakeWaDashboardAppointment({ id: 'a1' })],
      NOW,
    )

    expect(row).toEqual({
      id: 'a1',
      service: 'Consulta',
      professional: 'Dra. Bia',
      status: 'Confirmado',
      origin: 'Atendente',
      durationMinutes: 45,
      isUpcoming: true,
      isCanceled: false,
      noShowPct: null,
      leadHours: 50,
      startsAt: '2026-11-19T14:00:00.000Z',
      createdAt: '2026-11-17T12:00:00.000Z',
      canceledAt: null,
    })
  })

  it('should derive the flags of each status', () => {
    const past = new Date('2026-11-17T14:00:00.000Z')
    const rows = toWaAppointmentRows(
      [
        createFakeWaDashboardAppointment({ status: 'PENDING', source: 'FLOW' }),
        createFakeWaDashboardAppointment({ status: 'PENDING', startsAt: past }),
        createFakeWaDashboardAppointment({
          status: 'COMPLETED',
          source: 'CONTACT',
          startsAt: past,
        }),
        createFakeWaDashboardAppointment({ status: 'NO_SHOW', startsAt: past }),
        createFakeWaDashboardAppointment({
          status: 'CANCELED',
          canceledAt: past,
        }),
      ],
      NOW,
    )

    expect(rows.map((row) => row.status)).toEqual([
      'Aguardando confirmação',
      'Aguardando confirmação',
      'Concluído',
      'Faltou',
      'Cancelado',
    ])
    expect(rows.map((row) => row.origin).slice(0, 3)).toEqual([
      'Formulário (Flow)',
      'Atendente',
      'Contato',
    ])
    expect(rows.map((row) => row.isUpcoming)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ])
    expect(rows.map((row) => row.noShowPct)).toEqual([null, null, 0, 100, null])
    expect(rows[4]).toMatchObject({
      isCanceled: true,
      canceledAt: past.toISOString(),
    })
  })
})

describe('toWaChatbotSessionRows', () => {
  it('should flatten a session that reached the end of the flow', () => {
    const [row] = toWaChatbotSessionRows([
      createFakeWaDashboardChatbotSession({ id: 's1' }),
    ])

    expect(row).toEqual({
      id: 's1',
      chatbot: 'Triagem',
      status: 'Concluído',
      isRunning: false,
      isFinished: true,
      isHandoff: false,
      finishedPct: 100,
      endReason: 'Chegou ao fim do fluxo',
      durationMinutes: 4.5,
      team: null,
      connection: 'Principal',
      startedAt: '2026-11-17T12:00:00.000Z',
      endedAt: '2026-11-17T12:04:30.000Z',
    })
  })

  it('should measure a running session up to its last activity', () => {
    const [row] = toWaChatbotSessionRows([
      createFakeWaDashboardChatbotSession({
        status: 'RUNNING',
        endReason: null,
        endedAt: null,
      }),
    ])

    expect(row).toMatchObject({
      status: 'Em andamento',
      isRunning: true,
      isFinished: false,
      finishedPct: null,
      endReason: null,
      durationMinutes: 3,
      endedAt: null,
    })
  })

  it('should flag the handoffs and label the end reasons', () => {
    const rows = toWaChatbotSessionRows([
      createFakeWaDashboardChatbotSession({
        status: 'HANDED_OFF_HUMAN',
        endReason: 'handoff_human',
        conversation: {
          team: { name: 'Suporte' },
          connection: { label: 'Principal' },
        },
      }),
      createFakeWaDashboardChatbotSession({
        status: 'HANDED_OFF_AI',
        endReason: 'handoff_ai',
      }),
      createFakeWaDashboardChatbotSession({
        status: 'EXPIRED',
        endReason: 'timeout',
      }),
      createFakeWaDashboardChatbotSession({
        status: 'CANCELLED',
        endReason: 'finished',
      }),
      createFakeWaDashboardChatbotSession({
        status: 'FAILED',
        endReason: 'something_new',
      }),
    ])

    expect(rows.map((row) => row.status)).toEqual([
      'Passou para atendente',
      'Passou para a IA',
      'Expirou',
      'Cancelado',
      'Falhou',
    ])
    expect(rows.map((row) => row.isHandoff)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ])
    expect(rows.map((row) => row.finishedPct)).toEqual([0, 0, 0, 0, 0])
    expect(rows.map((row) => row.endReason)).toEqual([
      'Passou para atendente',
      'Passou para a IA',
      'Contato parou de responder',
      'Chegou ao fim do fluxo',
      'Outro motivo',
    ])
    expect(rows[0].team).toBe('Suporte')
  })
})

describe('toWaFlowResponseRows', () => {
  it('should flatten a send that waits for the answer', () => {
    const [row] = toWaFlowResponseRows({
      responses: [createFakeWaDashboardFlowResponse({ id: 'f1' })],
      users: [],
    })

    expect(row).toEqual({
      id: 'f1',
      flow: 'Cadastro de clientes',
      category: 'Cadastro',
      status: 'Aguardando resposta',
      isCompleted: false,
      completedPct: 0,
      crmRecord: null,
      attendant: null,
      minutesToRespond: null,
      createdAt: '2026-11-17T12:00:00.000Z',
      respondedAt: null,
    })
  })

  it('should derive the answer, the sender and the CRM record', () => {
    const answered = {
      status: 'COMPLETED' as const,
      respondedAt: new Date('2026-11-17T12:06:00.000Z'),
    }
    const rows = toWaFlowResponseRows({
      responses: [
        createFakeWaDashboardFlowResponse({
          ...answered,
          sentByUserId: 'u1',
          createdLeadId: 'lead1',
        }),
        createFakeWaDashboardFlowResponse({
          ...answered,
          sentByUserId: 'gone',
          createdPersonId: 'person1',
          flow: { name: 'Pesquisa', category: 'SURVEY' },
        }),
        createFakeWaDashboardFlowResponse({
          ...answered,
          createdCompanyId: 'company1',
          flow: { name: 'Livre', category: 'SOMETHING_NEW' },
        }),
      ],
      users: [{ id: 'u1', name: 'Ana' }],
    })

    expect(rows[0]).toMatchObject({
      status: 'Respondido',
      isCompleted: true,
      completedPct: 100,
      crmRecord: 'Lead',
      attendant: 'Ana',
      minutesToRespond: 6,
      respondedAt: '2026-11-17T12:06:00.000Z',
    })
    expect(rows.map((row) => row.crmRecord)).toEqual([
      'Lead',
      'Pessoa',
      'Empresa',
    ])
    expect(rows.map((row) => row.category)).toEqual([
      'Cadastro',
      'Pesquisa',
      'Outro',
    ])
    expect(rows[1].attendant).toBeNull()
  })
})

describe('toWaAdReferralRows', () => {
  it('should join the referral to its conversation', () => {
    const conversation = createFakeWaDashboardReferralConversation({
      team: { name: 'Vendas' },
    })
    const [row] = toWaAdReferralRows({
      referrals: [
        createFakeWaDashboardAdReferral({
          id: 'r1',
          conversationId: conversation.id,
          leadId: 'lead1',
        }),
      ],
      conversations: [conversation],
    })

    expect(row).toEqual({
      id: 'r1',
      sourceType: 'Anúncio',
      adId: '120210000000001',
      headline: 'Portabilidade sem taxa',
      ad: 'Portabilidade sem taxa',
      mediaType: 'Imagem',
      connection: 'Principal',
      team: 'Vendas',
      generatedLead: true,
      createdAt: '2026-11-17T12:00:00.000Z',
    })
  })

  it('should fall back when Meta sent little about the ad', () => {
    const rows = toWaAdReferralRows({
      referrals: [
        createFakeWaDashboardAdReferral({
          sourceType: 'post',
          headline: null,
          mediaType: 'video',
        }),
        createFakeWaDashboardAdReferral({
          sourceType: 'story',
          mediaType: 'carousel',
        }),
        createFakeWaDashboardAdReferral({ mediaType: null }),
      ],
      conversations: [createFakeWaDashboardReferralConversation()],
    })

    expect(rows[0]).toMatchObject({
      sourceType: 'Publicação',
      headline: null,
      ad: '120210000000001',
      mediaType: 'Vídeo',
      connection: null,
      team: null,
      generatedLead: false,
    })
    expect(rows[1]).toMatchObject({ sourceType: 'Outro', mediaType: 'Outro' })
    expect(rows[2].mediaType).toBeNull()
  })
})

describe('toWaAdSpendRows', () => {
  it('should spread the amount over the inclusive days of the period', () => {
    const [row] = toWaAdSpendRows([createFakeWaDashboardAdSpend({ id: 'sp1' })])

    expect(row).toEqual({
      id: 'sp1',
      adId: '120210000000001',
      ad: 'Campanha de novembro',
      amount: 1000,
      periodDays: 10,
      dailyAmount: 100,
      periodStart: '2026-11-01T00:00:00.000Z',
      periodEnd: '2026-11-10T00:00:00.000Z',
      createdAt: '2026-11-17T12:00:00.000Z',
    })
  })

  it('should name a spend without label by its ad id and survive a reversed period', () => {
    const [row] = toWaAdSpendRows([
      createFakeWaDashboardAdSpend({
        label: null,
        amount: new Prisma.Decimal('99.99'),
        periodStart: new Date('2026-11-10T00:00:00.000Z'),
        periodEnd: new Date('2026-11-01T00:00:00.000Z'),
      }),
    ])

    expect(row).toMatchObject({
      ad: '120210000000001',
      periodDays: 1,
      dailyAmount: 99.99,
    })
  })
})

describe('toWaContactRows', () => {
  it('should flatten a contact without any identity field', () => {
    const [row] = toWaContactRows([createFakeWaDashboardContact({ id: 'c1' })])

    expect(row).toEqual({
      id: 'c1',
      hasWhatsapp: 'Não verificado',
      isOptedOut: false,
      optOutSource: null,
      isBlocked: false,
      hasCrmPerson: false,
      createdAt: '2026-11-17T12:00:00.000Z',
      optedOutAt: null,
    })
  })

  it('should derive the opt-out, block and CRM flags', () => {
    const optedOutAt = new Date('2026-11-17T18:00:00.000Z')
    const rows = toWaContactRows([
      createFakeWaDashboardContact({
        hasWhatsapp: true,
        broadcastOptedOutAt: optedOutAt,
        broadcastOptOutSource: 'KEYWORD',
        crmPersonId: 'person1',
        blocks: [{ id: 'b1' }],
      }),
      createFakeWaDashboardContact({
        hasWhatsapp: false,
        broadcastOptedOutAt: optedOutAt,
        broadcastOptOutSource: 'ADMIN',
      }),
      createFakeWaDashboardContact({
        broadcastOptedOutAt: optedOutAt,
        broadcastOptOutSource: 'AI',
      }),
      createFakeWaDashboardContact({ broadcastOptedOutAt: optedOutAt }),
      // A source left behind after the opt-out was undone does not count.
      createFakeWaDashboardContact({ broadcastOptOutSource: 'ADMIN' }),
    ])

    expect(rows[0]).toMatchObject({
      hasWhatsapp: 'Sim',
      isOptedOut: true,
      optOutSource: 'Palavra-chave',
      isBlocked: true,
      hasCrmPerson: true,
      optedOutAt: optedOutAt.toISOString(),
    })
    expect(rows[1]).toMatchObject({
      hasWhatsapp: 'Não',
      optOutSource: 'Administrador',
    })
    expect(rows.map((row) => row.optOutSource)).toEqual([
      'Palavra-chave',
      'Administrador',
      'IA',
      null,
      null,
    ])
    expect(rows[4].isOptedOut).toBe(false)
  })
})
