import { createId } from '@paralleldrive/cuid2'
import { Prisma } from '@prisma/client'
import type {
  WaDashboardAdReferral,
  WaDashboardAdSpend,
  WaDashboardAppointment,
  WaDashboardBoletoCharge,
  WaDashboardCall,
  WaDashboardChatbotSession,
  WaDashboardContact,
  WaDashboardFlowResponse,
  WaDashboardPixCharge,
  WaDashboardReferralConversation,
} from '@/src/repositories/whatsapp-dashboard-channels.repository'

const CREATED_AT = new Date('2026-11-17T12:00:00.000Z')

export function createFakeWaDashboardCall(
  overrides?: Partial<WaDashboardCall>,
): WaDashboardCall {
  return {
    id: createId(),
    status: 'COMPLETED',
    direction: 'OUTBOUND',
    source: 'CLICK_TO_CALL',
    voiceAgent: false,
    recordingKey: null,
    sentiment: null,
    durationSeconds: 90,
    answeredAt: new Date('2026-11-17T12:00:20.000Z'),
    endedAt: new Date('2026-11-17T12:01:50.000Z'),
    createdAt: CREATED_AT,
    user: { name: 'Ana' },
    conversation: {
      team: { name: 'Retenção' },
      connection: { label: 'Principal' },
    },
    ...overrides,
  }
}

export function createFakeWaDashboardPixCharge(
  overrides?: Partial<WaDashboardPixCharge>,
): WaDashboardPixCharge {
  return {
    id: createId(),
    status: 'PENDING',
    amount: new Prisma.Decimal('150.50'),
    paidAmount: null,
    createdById: null,
    createdByAi: false,
    expiresAt: new Date('2026-11-17T13:00:00.000Z'),
    paidAt: null,
    createdAt: CREATED_AT,
    ...overrides,
  }
}

export function createFakeWaDashboardBoletoCharge(
  overrides?: Partial<WaDashboardBoletoCharge>,
): WaDashboardBoletoCharge {
  return {
    id: createId(),
    status: 'PENDING',
    amount: new Prisma.Decimal('300.00'),
    paidAmount: null,
    createdById: null,
    dueAt: new Date('2026-11-20T03:00:00.000Z'),
    paidAt: null,
    createdAt: CREATED_AT,
    ...overrides,
  }
}

export function createFakeWaDashboardAppointment(
  overrides?: Partial<WaDashboardAppointment>,
): WaDashboardAppointment {
  return {
    id: createId(),
    status: 'CONFIRMED',
    source: 'AGENT',
    startsAt: new Date('2026-11-19T14:00:00.000Z'),
    endsAt: new Date('2026-11-19T14:45:00.000Z'),
    canceledAt: null,
    createdAt: CREATED_AT,
    service: { name: 'Consulta' },
    professional: { name: 'Dra. Bia' },
    ...overrides,
  }
}

export function createFakeWaDashboardChatbotSession(
  overrides?: Partial<WaDashboardChatbotSession>,
): WaDashboardChatbotSession {
  return {
    id: createId(),
    status: 'COMPLETED',
    endReason: 'end_node',
    startedAt: CREATED_AT,
    lastActivityAt: new Date('2026-11-17T12:03:00.000Z'),
    endedAt: new Date('2026-11-17T12:04:30.000Z'),
    chatbot: { name: 'Triagem' },
    conversation: { team: null, connection: { label: 'Principal' } },
    ...overrides,
  }
}

export function createFakeWaDashboardFlowResponse(
  overrides?: Partial<WaDashboardFlowResponse>,
): WaDashboardFlowResponse {
  return {
    id: createId(),
    status: 'SENT',
    sentByUserId: null,
    createdLeadId: null,
    createdPersonId: null,
    createdCompanyId: null,
    sentAt: CREATED_AT,
    respondedAt: null,
    flow: { name: 'Cadastro de clientes', category: 'SIGN_UP' },
    ...overrides,
  }
}

export function createFakeWaDashboardAdReferral(
  overrides?: Partial<WaDashboardAdReferral>,
): WaDashboardAdReferral {
  return {
    id: createId(),
    sourceType: 'ad',
    sourceId: '120210000000001',
    headline: 'Portabilidade sem taxa',
    mediaType: 'image',
    conversationId: createId(),
    leadId: null,
    receivedAt: CREATED_AT,
    ...overrides,
  }
}

export function createFakeWaDashboardReferralConversation(
  overrides?: Partial<WaDashboardReferralConversation>,
): WaDashboardReferralConversation {
  return {
    id: createId(),
    team: null,
    connection: { label: 'Principal' },
    ...overrides,
  }
}

export function createFakeWaDashboardAdSpend(
  overrides?: Partial<WaDashboardAdSpend>,
): WaDashboardAdSpend {
  return {
    id: createId(),
    sourceId: '120210000000001',
    label: 'Campanha de novembro',
    periodStart: new Date('2026-11-01T00:00:00.000Z'),
    periodEnd: new Date('2026-11-10T00:00:00.000Z'),
    amount: new Prisma.Decimal('1000.00'),
    createdAt: CREATED_AT,
    ...overrides,
  }
}

export function createFakeWaDashboardContact(
  overrides?: Partial<WaDashboardContact>,
): WaDashboardContact {
  return {
    id: createId(),
    hasWhatsapp: null,
    broadcastOptedOutAt: null,
    broadcastOptOutSource: null,
    crmPersonId: null,
    createdAt: CREATED_AT,
    blocks: [],
    ...overrides,
  }
}
