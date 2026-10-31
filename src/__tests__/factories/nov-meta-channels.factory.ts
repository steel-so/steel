import { createId } from '@paralleldrive/cuid2'
import type {
  WhatsAppCoexistenceSync,
  WhatsAppConnection,
  WhatsAppMetaChannelSettings,
  WhatsAppSocialComment,
} from '@prisma/client'
import { createFakeWhatsAppConnection } from './whatsapp-connection.factory'

export function createFakeMetaChannelSettings(
  overrides?: Partial<WhatsAppMetaChannelSettings>,
): WhatsAppMetaChannelSettings {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    instagramEnabled: false,
    messengerEnabled: false,
    commentsEnabled: false,
    coexistenceEnabled: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/** A Messenger / Instagram connection backed by a Page token. */
export function createFakeSocialConnection(
  overrides?: Partial<WhatsAppConnection>,
): WhatsAppConnection {
  return createFakeWhatsAppConnection({
    provider: 'META',
    channel: 'MESSENGER',
    label: 'Messenger Loja',
    phoneNumber: 'fb:100200',
    status: 'CONNECTED',
    zapiInstanceId: null,
    encryptedZapiToken: null,
    metaPageId: '100200',
    encryptedMetaAccessToken: 'enc:page-token',
    ...overrides,
  })
}

/** A WhatsApp number connected through Coexistence. */
export function createFakeCoexistenceConnection(
  overrides?: Partial<WhatsAppConnection>,
): WhatsAppConnection {
  return createFakeWhatsAppConnection({
    provider: 'META',
    channel: 'WHATSAPP',
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

export function createFakeSocialComment(
  overrides?: Partial<WhatsAppSocialComment>,
): WhatsAppSocialComment {
  return {
    id: createId(),
    workspaceId: createId(),
    connectionId: createId(),
    messageId: createId(),
    commentId: 'comment-1',
    postId: 'post-1',
    parentCommentId: null,
    permalink: 'https://www.instagram.com/p/abc/',
    repliedAt: null,
    createdAt: new Date(),
    ...overrides,
  }
}
