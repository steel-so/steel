import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  createFakeWaDashboardActionRun,
  createFakeWaDashboardBroadcastRecipient,
  createFakeWaDashboardCost,
  createFakeWaDashboardMessage,
  createFakeWaDashboardTemplate,
} from '@/src/__tests__/factories/whatsapp-dashboard-messaging.factory'
import {
  toWaAiCampaignActionRows,
  toWaBroadcastRecipientRows,
  toWaCostRows,
  toWaMessageRows,
  toWaTemplateRows,
} from '../whatsapp-dashboard-messaging.mapper'

const AT = new Date('2026-11-17T12:00:00.000Z')

describe('toWaMessageRows', () => {
  it('should describe a message of the contact without delivery rates', () => {
    const [row] = toWaMessageRows([
      createFakeWaDashboardMessage({
        direction: 'IN',
        type: 'AUDIO',
        status: 'DELIVERED',
        sentiment: 'NEGATIVE',
        sentimentScore: -0.8,
        // A stale reason on a received message never reaches the row.
        failureReason: '131026: undeliverable',
        createdAt: AT,
        conversation: {
          connection: { label: 'Suporte', provider: 'ZAPI' },
          team: { name: 'Retenção' },
          aiCampaign: { name: 'Santander' },
        },
      }),
    ])

    expect(row).toMatchObject({
      direction: 'Recebida',
      type: 'Áudio',
      status: 'Recebida',
      author: 'Contato',
      attendant: null,
      isFailed: false,
      failureReason: null,
      deliveredPct: null,
      readPct: null,
      failedPct: null,
      sentiment: 'Negativo',
      sentimentScore: -0.8,
      connection: 'Suporte',
      provider: 'Z-API',
      team: 'Retenção',
      aiCampaign: 'Santander',
      createdAt: AT.toISOString(),
    })
  })

  it('should name who wrote each sent message', () => {
    const [ai, attendant, orphan, system] = toWaMessageRows([
      createFakeWaDashboardMessage({
        sentByAi: true,
        // The AI answers on behalf of nobody, even with a user on the row.
        senderUserId: 'u1',
        senderUser: { name: 'Ana' },
      }),
      createFakeWaDashboardMessage({
        senderUserId: 'u1',
        senderUser: { name: 'Ana' },
      }),
      createFakeWaDashboardMessage({ senderUserId: 'u2', senderUser: null }),
      createFakeWaDashboardMessage({ type: 'TEMPLATE' }),
    ])

    expect(ai).toMatchObject({ author: 'IA', attendant: null })
    expect(attendant).toMatchObject({ author: 'Atendente', attendant: 'Ana' })
    expect(orphan).toMatchObject({ author: 'Atendente', attendant: null })
    expect(system).toMatchObject({
      author: 'Sistema',
      attendant: null,
      type: 'Modelo',
      direction: 'Enviada',
      provider: 'Meta (API oficial)',
      team: null,
      aiCampaign: null,
      sentiment: null,
      sentimentScore: null,
    })
  })

  it('should turn the status of a sent message into 0/100 rates', () => {
    const rows = toWaMessageRows([
      createFakeWaDashboardMessage({ status: 'PENDING' }),
      createFakeWaDashboardMessage({ status: 'SENT' }),
      createFakeWaDashboardMessage({ status: 'DELIVERED' }),
      createFakeWaDashboardMessage({ status: 'READ' }),
      createFakeWaDashboardMessage({
        status: 'FAILED',
        failureReason: '131026: undeliverable',
      }),
    ])

    expect(
      rows.map((row) => [
        row.status,
        row.deliveredPct,
        row.readPct,
        row.failedPct,
      ]),
    ).toEqual([
      ['Pendente', 0, 0, 0],
      ['Enviada', 0, 0, 0],
      ['Entregue', 100, 0, 0],
      ['Lida', 100, 100, 0],
      ['Falhou', 0, 0, 100],
    ])
    expect(rows[4]).toMatchObject({
      isFailed: true,
      failureReason: '131026: undeliverable',
    })
    expect(rows[3]).toMatchObject({ isFailed: false, failureReason: null })
  })

  it('should never carry the text of the message nor the contact', () => {
    const [row] = toWaMessageRows([createFakeWaDashboardMessage()])

    expect(Object.keys(row).sort()).toEqual(
      [
        'aiCampaign',
        'attendant',
        'author',
        'connection',
        'createdAt',
        'deliveredPct',
        'direction',
        'failedPct',
        'failureReason',
        'id',
        'isFailed',
        'provider',
        'readPct',
        'sentiment',
        'sentimentScore',
        'status',
        'team',
        'type',
      ].sort(),
    )
  })
})

describe('toWaBroadcastRecipientRows', () => {
  it('should join the provider status of what was sent', () => {
    const rows = toWaBroadcastRecipientRows({
      recipients: [
        createFakeWaDashboardBroadcastRecipient({ providerMessageId: 'w1' }),
        createFakeWaDashboardBroadcastRecipient({ providerMessageId: 'w2' }),
        createFakeWaDashboardBroadcastRecipient({ providerMessageId: 'w3' }),
        createFakeWaDashboardBroadcastRecipient({ providerMessageId: 'w4' }),
        createFakeWaDashboardBroadcastRecipient({ providerMessageId: 'w5' }),
        createFakeWaDashboardBroadcastRecipient(),
      ],
      deliveries: [
        { providerMessageId: 'w1', status: 'READ' },
        { providerMessageId: 'w2', status: 'DELIVERED' },
        { providerMessageId: 'w3', status: 'FAILED' },
        { providerMessageId: 'w4', status: 'SENT' },
      ],
    })

    expect(rows.map((row) => [row.delivery, row.isDelivered])).toEqual([
      ['Lida', true],
      ['Entregue', true],
      ['Não entregue', false],
      ['Enviada', false],
      ['Enviada', false],
      ['Enviada', false],
    ])
    expect(rows[0]).toMatchObject({
      broadcast: 'Black Friday',
      broadcastStatus: 'Concluída',
      status: 'Enviado',
      isSent: true,
      isFailed: false,
      error: null,
      template: 'oferta_black_friday',
      connection: 'Principal',
      viaMarketingLite: false,
      scheduledAt: null,
      sentAt: '2026-11-17T12:00:00.000Z',
      createdAt: '2026-11-17T11:00:00.000Z',
    })
  })

  it('should leave the delivery empty for what was not sent', () => {
    const [failed, pending, skipped, noWhatsapp] = toWaBroadcastRecipientRows({
      recipients: [
        createFakeWaDashboardBroadcastRecipient({
          status: 'FAILED',
          // A status of an earlier attempt does not count as a delivery.
          providerMessageId: 'w1',
          errorMessage: 'Template não encontrado',
          sentAt: null,
        }),
        createFakeWaDashboardBroadcastRecipient({
          status: 'PENDING',
          sentAt: null,
          scheduledAt: AT,
          viaMarketingLite: true,
          broadcastList: {
            name: 'Lembretes',
            status: 'QUEUED',
            template: null,
            connection: { label: 'Suporte' },
          },
        }),
        createFakeWaDashboardBroadcastRecipient({
          status: 'SKIPPED',
          sentAt: null,
        }),
        createFakeWaDashboardBroadcastRecipient({
          status: 'SKIPPED_NO_WHATSAPP',
          sentAt: null,
        }),
      ],
      deliveries: [{ providerMessageId: 'w1', status: 'READ' }],
    })

    expect(failed).toMatchObject({
      status: 'Falhou',
      isSent: false,
      isFailed: true,
      error: 'Template não encontrado',
      delivery: null,
      isDelivered: false,
      sentAt: null,
    })
    expect(pending).toMatchObject({
      broadcast: 'Lembretes',
      broadcastStatus: 'Agendada',
      status: 'Pendente',
      isSent: false,
      isFailed: false,
      template: null,
      connection: 'Suporte',
      viaMarketingLite: true,
      delivery: null,
      scheduledAt: AT.toISOString(),
    })
    expect(skipped.status).toBe('Ignorado')
    expect(noWhatsapp.status).toBe('Sem WhatsApp')
  })
})

describe('toWaTemplateRows', () => {
  it('should count the stored buttons before the ones of the components', () => {
    const [row] = toWaTemplateRows([
      createFakeWaDashboardTemplate({
        headerFormat: 'IMAGE',
        buttons: [
          { id: 'b1', type: 'REPLY', label: 'Sim', actions: [] },
          { id: 'b2', type: 'REPLY', label: 'Não', actions: [] },
        ],
        components: [
          { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Sim' }] },
        ],
      }),
    ])

    expect(row).toMatchObject({
      name: 'oferta_black_friday',
      language: 'pt_BR',
      category: 'Marketing',
      status: 'Aprovado',
      quality: 'Alta',
      connection: 'Principal',
      header: 'Imagem',
      hasButtons: true,
      buttonCount: 2,
      createdAt: '2026-10-01T12:00:00.000Z',
      updatedAt: '2026-11-17T12:00:00.000Z',
    })
  })

  it('should derive the buttons of a template synced from Meta', () => {
    const [derived, none] = toWaTemplateRows([
      createFakeWaDashboardTemplate({
        category: 'UTILITY',
        status: 'PAUSED',
        quality: 'RED',
        components: [
          { type: 'BODY', text: 'Olá' },
          {
            type: 'BUTTONS',
            buttons: [
              { type: 'QUICK_REPLY', text: 'Sim' },
              { type: 'URL', text: 'Site', url: 'https://example.com' },
              { type: 'PHONE_NUMBER', text: 'Ligar' },
            ],
          },
        ],
      }),
      createFakeWaDashboardTemplate({
        // A category Meta adds later keeps its own name.
        category: 'SERVICE_UPDATE',
        status: 'REJECTED',
        quality: 'UNKNOWN',
      }),
    ])

    expect(derived).toMatchObject({
      category: 'Utilidade',
      status: 'Pausado',
      quality: 'Baixa',
      hasButtons: true,
      buttonCount: 2,
    })
    expect(none).toMatchObject({
      category: 'SERVICE_UPDATE',
      status: 'Rejeitado',
      quality: 'Sem avaliação',
      header: null,
      hasButtons: false,
      buttonCount: 0,
    })
  })
})

describe('toWaCostRows', () => {
  it('should turn the ledger entry into numbers and labels', () => {
    const [row] = toWaCostRows({
      entries: [
        createFakeWaDashboardCost({
          quantity: 3,
          estimatedCost: new Prisma.Decimal('1.0875'),
          broadcastId: 'b1',
          viaMarketingLite: true,
          occurredAt: AT,
        }),
      ],
      broadcasts: [{ id: 'b1', name: 'Black Friday' }],
      aiCampaigns: [],
    })

    expect(row).toMatchObject({
      category: 'Marketing',
      kind: 'Modelo',
      origin: 'Transmissões',
      amount: 1.0875,
      unitPrice: 0.3625,
      quantity: 3,
      currency: 'BRL',
      connection: 'Principal',
      provider: 'Meta (API oficial)',
      viaMarketingLite: true,
      isReversed: false,
      broadcast: 'Black Friday',
      aiCampaign: null,
      occurredAt: AT.toISOString(),
    })
  })

  it('should name the AI campaign and flag a reversed entry', () => {
    const [campaign, removed, service] = toWaCostRows({
      entries: [
        createFakeWaDashboardCost({
          category: 'UTILITY',
          source: 'AI_CAMPAIGN',
          aiCampaignId: 'c1',
          estimatedCost: new Prisma.Decimal('0'),
          reversedAt: AT,
        }),
        // The list and the campaign were deleted after the send.
        createFakeWaDashboardCost({
          broadcastId: 'gone',
          aiCampaignId: 'gone',
        }),
        createFakeWaDashboardCost({
          category: 'SERVICE',
          kind: 'SERVICE',
          source: 'AGENT',
          provider: 'ZAPI',
          unitPrice: new Prisma.Decimal('0'),
          estimatedCost: new Prisma.Decimal('0'),
        }),
      ],
      broadcasts: [],
      aiCampaigns: [{ id: 'c1', name: 'Santander' }],
    })

    expect(campaign).toMatchObject({
      category: 'Utilidade',
      origin: 'Campanhas de IA',
      amount: 0,
      isReversed: true,
      broadcast: null,
      aiCampaign: 'Santander',
    })
    expect(removed).toMatchObject({ broadcast: null, aiCampaign: null })
    expect(service).toMatchObject({
      category: 'Atendimento (janela de 24 h)',
      kind: 'Atendimento',
      origin: 'Atendentes',
      provider: 'Z-API',
      amount: 0,
      unitPrice: 0,
    })
  })
})

describe('toWaAiCampaignActionRows', () => {
  it('should label the action and its result', () => {
    const [success, failed] = toWaAiCampaignActionRows([
      createFakeWaDashboardActionRun({ createdAt: AT }),
      createFakeWaDashboardActionRun({
        kind: 'WEBHOOK',
        label: 'Avisar o ERP',
        status: 'FAILED',
        error: 'HTTP 500',
        campaign: { name: 'Inter' },
      }),
    ])

    expect(success).toMatchObject({
      campaign: 'Santander',
      actionType: 'Transferir para uma equipe',
      action: 'Passar para a Retenção',
      status: 'Sucesso',
      isSuccess: true,
      error: null,
      createdAt: AT.toISOString(),
    })
    expect(failed).toMatchObject({
      campaign: 'Inter',
      actionType: 'Chamar webhook',
      action: 'Avisar o ERP',
      status: 'Falhou',
      isSuccess: false,
      error: 'HTTP 500',
    })
  })

  it('should keep the code of a kind that no longer exists', () => {
    const [row] = toWaAiCampaignActionRows([
      createFakeWaDashboardActionRun({ kind: 'LEGACY_KIND' }),
    ])

    expect(row.actionType).toBe('LEGACY_KIND')
  })
})
