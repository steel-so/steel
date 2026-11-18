import { createId } from '@paralleldrive/cuid2'
import type {
  WaDashboardConversation,
  WaDashboardRecipient,
} from '@/src/repositories/whatsapp-dashboard-source.repository'

export function createFakeWaDashboardRecipient(
  overrides?: Partial<WaDashboardRecipient>,
): WaDashboardRecipient {
  return {
    id: createId(),
    status: 'SENT',
    conversationId: null,
    providerMessageId: null,
    sentAt: new Date('2026-11-17T12:00:00.000Z'),
    repliedAt: null,
    createdAt: new Date('2026-11-17T11:00:00.000Z'),
    campaign: { name: 'Santander', status: 'DONE' },
    contact: { waId: '5511988887777' },
    ...overrides,
  }
}

export function createFakeWaDashboardConversation(
  overrides?: Partial<WaDashboardConversation>,
): WaDashboardConversation {
  return {
    id: createId(),
    status: 'IN_PROGRESS',
    assignedUserId: null,
    aiHandoff: false,
    closeOutcome: null,
    closeStatusLabels: [],
    closedAt: null,
    lastInboundAt: new Date('2026-11-17T12:30:00.000Z'),
    assignedUser: null,
    team: null,
    contact: { waId: '5511988887777' },
    ...overrides,
  }
}
