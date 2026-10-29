import { createId } from '@paralleldrive/cuid2'
import type {
  WhatsAppBroadcastList,
  WhatsAppBroadcastRecipient,
} from '@prisma/client'
import type {
  WhatsAppBroadcastListWithCounts,
  WhatsAppBroadcastListWithRecipients,
} from '@/src/repositories/whatsapp-broadcast.repository'
import { createFakeWhatsAppContact } from './whatsapp-contact.factory'

export function createFakeWhatsAppBroadcastList(
  overrides?: Partial<WhatsAppBroadcastList>,
): WhatsAppBroadcastList {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    connectionId: createId(),
    templateId: null,
    name: 'Promoção de fim de ano',
    messageBody: 'Aproveite nossas ofertas!',
    mediaUrl: null,
    mediaType: null,
    mediaMimeType: null,
    mediaFileName: null,
    status: 'DRAFT',
    scheduledAt: null,
    skipNoWhatsapp: false,
    createdById: createId(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeWhatsAppBroadcastRecipient(
  overrides?: Partial<WhatsAppBroadcastRecipient>,
): WhatsAppBroadcastRecipient {
  return {
    id: createId(),
    broadcastListId: createId(),
    contactId: createId(),
    status: 'PENDING',
    variableValues: null,
    scheduledAt: null,
    appointmentAt: null,
    providerMessageId: null,
    errorMessage: null,
    sentAt: null,
    viaMarketingLite: false,
    createdAt: new Date(),
    ...overrides,
  }
}

export function createFakeWhatsAppBroadcastListWithCounts(
  overrides?: Partial<WhatsAppBroadcastList>,
  recipients: Pick<WhatsAppBroadcastRecipient, 'status'>[] = [],
): WhatsAppBroadcastListWithCounts {
  return {
    ...createFakeWhatsAppBroadcastList(overrides),
    recipients,
  } as WhatsAppBroadcastListWithCounts
}

export function createFakeWhatsAppBroadcastListWithRecipients(
  overrides?: Partial<WhatsAppBroadcastList>,
  recipientCount = 1,
): WhatsAppBroadcastListWithRecipients {
  const list = createFakeWhatsAppBroadcastList(overrides)
  const recipients = Array.from({ length: recipientCount }, () => ({
    ...createFakeWhatsAppBroadcastRecipient({ broadcastListId: list.id }),
    contact: createFakeWhatsAppContact(),
  }))

  return { ...list, recipients } as WhatsAppBroadcastListWithRecipients
}
