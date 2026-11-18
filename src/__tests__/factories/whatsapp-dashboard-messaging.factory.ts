import { createId } from '@paralleldrive/cuid2'
import { Prisma } from '@prisma/client'
import type {
  WaDashboardActionRun,
  WaDashboardBroadcastRecipient,
  WaDashboardCost,
  WaDashboardMessage,
  WaDashboardTemplate,
} from '@/src/repositories/whatsapp-dashboard-messaging.repository'

export function createFakeWaDashboardMessage(
  overrides?: Partial<WaDashboardMessage>,
): WaDashboardMessage {
  return {
    id: createId(),
    direction: 'OUT',
    type: 'TEXT',
    status: 'SENT',
    senderUserId: null,
    sentByAi: false,
    sentiment: null,
    sentimentScore: null,
    failureReason: null,
    createdAt: new Date('2026-11-17T12:00:00.000Z'),
    senderUser: null,
    conversation: {
      connection: { label: 'Principal', provider: 'META' },
      team: null,
      aiCampaign: null,
    },
    ...overrides,
  }
}

export function createFakeWaDashboardBroadcastRecipient(
  overrides?: Partial<WaDashboardBroadcastRecipient>,
): WaDashboardBroadcastRecipient {
  return {
    id: createId(),
    status: 'SENT',
    providerMessageId: null,
    errorMessage: null,
    scheduledAt: null,
    sentAt: new Date('2026-11-17T12:00:00.000Z'),
    viaMarketingLite: false,
    createdAt: new Date('2026-11-17T11:00:00.000Z'),
    broadcastList: {
      name: 'Black Friday',
      status: 'DONE',
      template: { name: 'oferta_black_friday' },
      connection: { label: 'Principal' },
    },
    ...overrides,
  }
}

export function createFakeWaDashboardTemplate(
  overrides?: Partial<WaDashboardTemplate>,
): WaDashboardTemplate {
  return {
    id: createId(),
    name: 'oferta_black_friday',
    language: 'pt_BR',
    category: 'MARKETING',
    status: 'APPROVED',
    quality: 'GREEN',
    headerFormat: null,
    components: [],
    buttons: null,
    createdAt: new Date('2026-10-01T12:00:00.000Z'),
    updatedAt: new Date('2026-11-17T12:00:00.000Z'),
    connection: { label: 'Principal' },
    ...overrides,
  }
}

export function createFakeWaDashboardCost(
  overrides?: Partial<WaDashboardCost>,
): WaDashboardCost {
  return {
    id: createId(),
    provider: 'META',
    occurredAt: new Date('2026-11-17T12:00:00.000Z'),
    category: 'MARKETING',
    kind: 'TEMPLATE',
    source: 'BROADCAST',
    currency: 'BRL',
    broadcastId: null,
    aiCampaignId: null,
    quantity: 1,
    unitPrice: new Prisma.Decimal('0.3625'),
    estimatedCost: new Prisma.Decimal('0.3625'),
    viaMarketingLite: false,
    reversedAt: null,
    connection: { label: 'Principal' },
    ...overrides,
  }
}

export function createFakeWaDashboardActionRun(
  overrides?: Partial<WaDashboardActionRun>,
): WaDashboardActionRun {
  return {
    id: createId(),
    kind: 'TRANSFER_TEAM',
    label: 'Passar para a Retenção',
    status: 'SUCCESS',
    error: null,
    createdAt: new Date('2026-11-17T12:00:00.000Z'),
    campaign: { name: 'Santander' },
    ...overrides,
  }
}
