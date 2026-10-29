import { createId } from '@paralleldrive/cuid2'
import type { WhatsAppChatbot, WhatsAppChatbotSession } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { initialChatbotState } from '@/src/lib/whatsapp/chatbot/engine'
import { blankFlow, menuFlow } from '@/src/lib/whatsapp/chatbot/templates'
import type { ChatbotFlow } from '@/src/schemas/whatsapp-chatbot.schema'

export function createFakeChatbot(
  overrides?: Partial<WhatsAppChatbot>,
): WhatsAppChatbot {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    connectionId: null,
    name: 'Atendimento inicial',
    description: null,
    status: 'DRAFT',
    triggerKind: 'NEW_CONVERSATION',
    keywords: [],
    sessionTtlMinutes: 720,
    draft: blankFlow() as unknown as WhatsAppChatbot['draft'],
    published: null,
    publishedVersion: 0,
    publishedAt: null,
    createdByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/** An ACTIVE bot with `flow` already published. */
export function createFakePublishedChatbot(
  flow: ChatbotFlow = menuFlow(),
  overrides?: Partial<WhatsAppChatbot>,
): WhatsAppChatbot {
  return createFakeChatbot({
    status: 'ACTIVE',
    draft: flow as unknown as WhatsAppChatbot['draft'],
    published: flow as unknown as WhatsAppChatbot['published'],
    publishedVersion: 1,
    publishedAt: new Date(),
    ...overrides,
  })
}

export function createFakeChatbotSession(
  overrides?: Partial<WhatsAppChatbotSession>,
): WhatsAppChatbotSession {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    chatbotId: createId(),
    conversationId: createId(),
    status: 'RUNNING',
    botVersion: 1,
    state: initialChatbotState() as unknown as WhatsAppChatbotSession['state'],
    definition: menuFlow() as unknown as WhatsAppChatbotSession['definition'],
    endReason: null,
    startedAt: now,
    lastActivityAt: now,
    endedAt: null,
    ...overrides,
  }
}

let counter = 0

/** Real rows for the repository integration tests. */
export async function seedChatbotFixtures(workspaceId: string, userId: string) {
  counter += 1
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider: 'ZAPI',
      label: 'Suporte',
      phoneNumber: '5511999999999',
      zapiInstanceId: `bot-instance-${counter}-${createId()}`,
      encryptedZapiToken: 'enc:token',
      createdById: userId,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: {
      workspaceId,
      waId: `55119${counter}${Date.now()}`.slice(0, 13),
      name: 'Maria',
    },
  })
  const conversation = await prisma.whatsAppConversation.create({
    data: {
      workspaceId,
      connectionId: connection.id,
      contactId: contact.id,
      status: 'NEW',
    },
  })
  return { connection, contact, conversation }
}
