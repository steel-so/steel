import { createId } from '@paralleldrive/cuid2'
import type {
  WhatsAppAdReferral,
  WhatsAppAdSettings,
  WhatsAppAdSpend,
} from '@prisma/client'
import type { InboundAdReferral } from '@/src/lib/whatsapp/ad-referral'

export function createFakeWhatsAppAdSettings(
  overrides?: Partial<WhatsAppAdSettings>,
): WhatsAppAdSettings {
  const now = new Date()
  return {
    workspaceId: createId(),
    enabled: true,
    createLeads: false,
    leadOwnerId: null,
    leadSource: 'Anúncio Click-to-WhatsApp',
    updatedById: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeWhatsAppAdReferral(
  overrides?: Partial<WhatsAppAdReferral>,
): WhatsAppAdReferral {
  return {
    id: createId(),
    workspaceId: createId(),
    contactId: createId(),
    conversationId: createId(),
    providerMessageId: `wamid.${createId()}`,
    sourceType: 'ad',
    sourceId: '120210000000001',
    sourceUrl: 'https://fb.me/ad1',
    headline: 'Promoção de verão',
    body: 'Fale com a gente',
    mediaType: 'image',
    mediaUrl: 'https://cdn.example/ad.jpg',
    ctwaClid: 'clid-1',
    leadId: null,
    receivedAt: new Date('2026-10-10T15:00:00.000Z'),
    ...overrides,
  }
}

export function createFakeWhatsAppAdSpend(
  overrides?: Partial<WhatsAppAdSpend>,
): WhatsAppAdSpend {
  return {
    id: createId(),
    workspaceId: createId(),
    sourceId: '120210000000001',
    label: 'Promoção de verão',
    periodStart: new Date('2026-10-01T00:00:00.000Z'),
    periodEnd: new Date('2026-10-10T00:00:00.000Z'),
    amount: 1000 as unknown as WhatsAppAdSpend['amount'],
    note: null,
    createdById: createId(),
    createdAt: new Date('2026-10-11T12:00:00.000Z'),
    ...overrides,
  }
}

export function createFakeInboundAdReferral(
  overrides?: Partial<InboundAdReferral>,
): InboundAdReferral {
  return {
    sourceType: 'ad',
    sourceId: '120210000000001',
    sourceUrl: 'https://fb.me/ad1',
    headline: 'Promoção de verão',
    body: 'Fale com a gente',
    mediaType: 'image',
    mediaUrl: 'https://cdn.example/ad.jpg',
    ctwaClid: 'clid-1',
    ...overrides,
  }
}
