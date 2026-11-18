import { describe, expect, it } from 'vitest'
import {
  createFakeWaDashboardConversation,
  createFakeWaDashboardRecipient,
} from '@/src/__tests__/factories/whatsapp-dashboard.factory'
import type { WaAiCampaignRecipientData } from '@/src/repositories/whatsapp-dashboard-source.repository'
import {
  toWaAiCampaignRecipientRows,
  waButtonAnswerLabel,
} from '../whatsapp-dashboard-source.mapper'

const SENT_AT = new Date('2026-11-17T12:00:00.000Z')
const AFTER = new Date('2026-11-17T12:30:00.000Z')
const BEFORE = new Date('2026-11-16T09:00:00.000Z')

function dataOf(
  overrides: Partial<WaAiCampaignRecipientData>,
): WaAiCampaignRecipientData {
  return {
    recipients: [],
    conversations: [],
    buttonReplies: [],
    humanReplies: [],
    deliveries: [],
    ...overrides,
  }
}

describe('waButtonAnswerLabel', () => {
  it('should fold the spellings of yes and no into one label each', () => {
    expect(waButtonAnswerLabel('SIM')).toBe('Sim')
    expect(waButtonAnswerLabel(' sim ')).toBe('Sim')
    expect(waButtonAnswerLabel('NAO')).toBe('Não')
    expect(waButtonAnswerLabel('NÃO')).toBe('Não')
    expect(waButtonAnswerLabel('Não')).toBe('Não')
  })

  it('should keep the text of any other button and name an empty one', () => {
    expect(waButtonAnswerLabel('Outro horário')).toBe('Outro horário')
    expect(waButtonAnswerLabel(null)).toBe('Outra resposta')
    expect(waButtonAnswerLabel('  ')).toBe('Outra resposta')
  })
})

describe('toWaAiCampaignRecipientRows', () => {
  it('should answer an empty row for a recipient that was not sent', () => {
    const [pending, failed] = toWaAiCampaignRecipientRows(
      dataOf({
        recipients: [
          createFakeWaDashboardRecipient({ status: 'PENDING', sentAt: null }),
          createFakeWaDashboardRecipient({
            status: 'FAILED',
            campaign: { name: 'Inter', status: 'RUNNING' },
          }),
        ],
      }),
    )

    expect(pending).toMatchObject({
      campaign: 'Santander',
      campaignStatus: 'Concluída',
      sendStatus: 'Pendente',
      isSent: false,
      delivery: null,
      isDelivered: false,
      response: null,
      replied: false,
      transferred: false,
      stage: null,
      isWaiting: false,
      sentAt: null,
      closeStatus: [],
    })
    expect(failed).toMatchObject({
      campaign: 'Inter',
      campaignStatus: 'Enviando',
      sendStatus: 'Falhou',
      isSent: false,
    })
  })

  it('should mark a sent recipient without an answer as no return', () => {
    const [read, undelivered, unknown] = toWaAiCampaignRecipientRows(
      dataOf({
        recipients: [
          createFakeWaDashboardRecipient({ providerMessageId: 'wamid.1' }),
          createFakeWaDashboardRecipient({ providerMessageId: 'wamid.2' }),
          createFakeWaDashboardRecipient({ providerMessageId: 'wamid.3' }),
        ],
        deliveries: [
          { providerMessageId: 'wamid.1', status: 'READ' },
          { providerMessageId: 'wamid.2', status: 'FAILED' },
        ],
      }),
    )

    expect(read).toMatchObject({
      isSent: true,
      delivery: 'Lida',
      isDelivered: true,
      response: 'Sem retorno',
      replied: false,
      stage: 'Sem retorno',
      isWaiting: false,
      sentAt: SENT_AT.toISOString(),
      repliedAt: null,
    })
    expect(undelivered).toMatchObject({
      delivery: 'Não entregue',
      isDelivered: false,
    })
    expect(unknown).toMatchObject({ delivery: 'Enviada', isDelivered: false })
  })

  it('should read the answer from the conversation of the campaign', () => {
    const conversation = createFakeWaDashboardConversation({
      id: 'c1',
      status: 'IN_PROGRESS',
      assignedUserId: 'u1',
      assignedUser: { name: 'Ana' },
      team: { name: 'Retenção' },
    })
    const [row] = toWaAiCampaignRecipientRows(
      dataOf({
        recipients: [
          createFakeWaDashboardRecipient({
            conversationId: 'c1',
            providerMessageId: 'wamid.1',
          }),
        ],
        conversations: [conversation],
        buttonReplies: [
          { conversationId: 'c1', text: 'NAO', createdAt: BEFORE },
          { conversationId: 'c1', text: 'SIM', createdAt: AFTER },
        ],
        humanReplies: [{ conversationId: 'c1', lastAt: AFTER }],
        deliveries: [{ providerMessageId: 'wamid.1', status: 'DELIVERED' }],
      }),
    )

    expect(row).toMatchObject({
      delivery: 'Entregue',
      isDelivered: true,
      response: 'Sim',
      replied: true,
      transferred: true,
      stage: 'Em atendimento',
      isWaiting: false,
      attendant: 'Ana',
      team: 'Retenção',
      repliedAt: AFTER.toISOString(),
    })
  })

  it('should join the answer that came without the ninth digit', () => {
    const [row] = toWaAiCampaignRecipientRows(
      dataOf({
        recipients: [
          createFakeWaDashboardRecipient({
            conversationId: 'own',
            contact: { waId: '5511988887777' },
          }),
        ],
        conversations: [
          createFakeWaDashboardConversation({
            id: 'twin',
            status: 'NEW',
            aiHandoff: true,
            contact: { waId: '551188887777' },
          }),
        ],
        buttonReplies: [
          { conversationId: 'twin', text: 'Não', createdAt: AFTER },
        ],
      }),
    )

    expect(row).toMatchObject({
      response: 'Não',
      replied: true,
      isDelivered: true,
      transferred: true,
      stage: 'Aguardando atendimento',
      isWaiting: true,
    })
  })

  it('should ignore answers and human messages older than the send', () => {
    const [row] = toWaAiCampaignRecipientRows(
      dataOf({
        recipients: [createFakeWaDashboardRecipient({ conversationId: 'c1' })],
        conversations: [
          createFakeWaDashboardConversation({
            id: 'c1',
            lastInboundAt: BEFORE,
          }),
          createFakeWaDashboardConversation({
            id: 'c2',
            lastInboundAt: null,
          }),
        ],
        buttonReplies: [
          { conversationId: 'c1', text: 'SIM', createdAt: BEFORE },
        ],
        humanReplies: [{ conversationId: 'c1', lastAt: BEFORE }],
      }),
    )

    expect(row).toMatchObject({
      response: 'Sem retorno',
      replied: false,
      stage: 'Sem retorno',
    })
  })

  it('should treat a free-text answer as another answer still waiting', () => {
    const [row] = toWaAiCampaignRecipientRows(
      dataOf({
        recipients: [createFakeWaDashboardRecipient({ conversationId: 'c1' })],
        conversations: [
          createFakeWaDashboardConversation({ id: 'c1', status: 'NEW' }),
        ],
        humanReplies: [{ conversationId: 'c1', lastAt: BEFORE }],
      }),
    )

    expect(row).toMatchObject({
      response: 'Outra resposta',
      replied: true,
      transferred: false,
      stage: 'Aguardando atendimento',
      isWaiting: true,
      repliedAt: AFTER.toISOString(),
    })
  })

  it('should carry the close classification of a closed conversation', () => {
    const closedAt = new Date('2026-11-18T12:16:10.000Z')
    const [row] = toWaAiCampaignRecipientRows(
      dataOf({
        recipients: [createFakeWaDashboardRecipient({ conversationId: 'c1' })],
        conversations: [
          createFakeWaDashboardConversation({
            id: 'old',
            status: 'CLOSED',
            closeOutcome: 'FAILURE',
            lastInboundAt: new Date('2026-11-17T12:10:00.000Z'),
          }),
          createFakeWaDashboardConversation({
            id: 'c1',
            status: 'CLOSED',
            closeOutcome: 'SUCCESS',
            closeStatusLabels: ['Aceite de ligação'],
            closedAt,
          }),
        ],
      }),
    )

    expect(row).toMatchObject({
      stage: 'Encerrada',
      isWaiting: false,
      outcome: 'Deu certo',
      closeStatus: ['Aceite de ligação'],
      closedAt: closedAt.toISOString(),
    })
  })

  it('should keep a recorded answer whose conversation is gone', () => {
    const repliedAt = new Date('2026-11-17T13:00:00.000Z')
    const [row] = toWaAiCampaignRecipientRows(
      dataOf({
        recipients: [
          createFakeWaDashboardRecipient({ conversationId: 'gone', repliedAt }),
        ],
      }),
    )

    expect(row).toMatchObject({
      response: 'Outra resposta',
      replied: true,
      stage: 'Encerrada',
      transferred: false,
      attendant: null,
      outcome: null,
      repliedAt: repliedAt.toISOString(),
    })
  })
})
