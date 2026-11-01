import { createId } from '@paralleldrive/cuid2'
import type {
  WhatsAppCoexistenceSync,
  WhatsAppConnection,
  WhatsAppMetaChannelSettings,
} from '@prisma/client'
import { createFakeWhatsAppConnection } from './whatsapp-connection.factory'

export function createFakeMetaChannelSettings(
  overrides?: Partial<WhatsAppMetaChannelSettings>,
): WhatsAppMetaChannelSettings {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    coexistenceEnabled: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/** A WhatsApp number connected through Coexistence. */
export function createFakeCoexistenceConnection(
  overrides?: Partial<WhatsAppConnection>,
): WhatsAppConnection {
  return createFakeWhatsAppConnection({
    provider: 'META',
    coexistence: true,
    status: 'CONNECTED',
    phoneNumber: '5511999990000',
    zapiInstanceId: null,
    encryptedZapiToken: null,
    metaPhoneNumberId: '555000111',
    metaWabaId: '777000222',
    encryptedMetaAccessToken: 'enc:token',
    ...overrides,
  })
}

export function createFakeCoexistenceSync(
  overrides?: Partial<WhatsAppCoexistenceSync>,
): WhatsAppCoexistenceSync {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    connectionId: createId(),
    status: 'PENDING',
    progress: 0,
    contactsImported: 0,
    messagesImported: 0,
    conversationsTouched: 0,
    error: null,
    startedAt: now,
    finishedAt: null,
    updatedAt: now,
    ...overrides,
  }
}
