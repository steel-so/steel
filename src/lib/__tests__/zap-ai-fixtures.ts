import type { Workspace } from '@prisma/client'
import type { AiToolContext, SteelAiTool } from '@/src/lib/ai/tools/types'
import type { WhatsAppBroadcastListDetailDTO } from '@/types/whatsapp-broadcast'
import type { WhatsAppConnectionDTO } from '@/types/whatsapp-connection'
import type { WhatsAppContactDTO } from '@/types/whatsapp-contact'
import type { WhatsAppConversationDTO } from '@/types/whatsapp-conversation'
import type { WhatsAppGroupDTO } from '@/types/whatsapp-group'
import type { WhatsAppMessageDTO } from '@/types/whatsapp-message'
import type { WhatsAppQuickReplyDTO } from '@/types/whatsapp-quick-reply'
import type { WhatsAppTemplateDTO } from '@/types/whatsapp-template'

/** DTO builders shared by the Comunicação Steel AI tool tests. */

export const ctx = {
  workspaceId: 'ws1',
  actorId: 'u1',
  source: 'assistant' as const,
}

export const workspace = { id: 'ws1', slug: 'acme' } as Workspace

const ISO = '2026-10-06T12:00:00.000Z'

export function conversation(
  overrides: Partial<WhatsAppConversationDTO> = {},
): WhatsAppConversationDTO {
  return {
    id: 'c1',
    workspaceId: 'ws1',
    connectionId: 'cn1',
    contactId: 'ct1',
    contactName: 'Maria',
    contactWaId: '5511999990000',
    contactAvatarUrl: null,
    status: 'IN_PROGRESS',
    assignedUserId: null,
    teamId: null,
    team: null,
    aiActive: false,
    aiHandoff: false,
    unreadCount: 0,
    avgSentimentScore: null,
    lastMessageAt: ISO,
    lastMessagePreview: 'Olá',
    pinned: false,
    archived: false,
    closedAt: null,
    closeReason: null,
    contactSince: ISO,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  }
}

export function message(
  overrides: Partial<WhatsAppMessageDTO> = {},
): WhatsAppMessageDTO {
  return {
    id: 'm1',
    workspaceId: 'ws1',
    conversationId: 'c1',
    direction: 'IN',
    type: 'TEXT',
    text: 'Oi',
    mediaUrl: null,
    status: 'DELIVERED',
    senderUserId: null,
    sentByAi: false,
    replyToMessageId: null,
    reactionEmoji: null,
    reactedByContact: null,
    contactPayload: null,
    buttons: null,
    buttonPayload: null,
    createdAt: ISO,
    ...overrides,
  }
}

export function contact(
  overrides: Partial<WhatsAppContactDTO> = {},
): WhatsAppContactDTO {
  return {
    id: 'ct1',
    workspaceId: 'ws1',
    waId: '5511999990000',
    name: 'Maria',
    avatarUrl: null,
    description: null,
    broadcastOptedOutAt: null,
    broadcastOptOutSource: null,
    conversationCount: 1,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  }
}

export function connection(
  overrides: Partial<WhatsAppConnectionDTO> = {},
): WhatsAppConnectionDTO {
  return {
    id: 'cn1',
    workspaceId: 'ws1',
    provider: 'ZAPI',
    label: 'Comercial',
    phoneNumber: '+55 11 4000-0000',
    status: 'CONNECTED',
    statusError: null,
    zapiInstanceId: 'z1',
    metaPhoneNumberId: null,
    metaWabaId: null,
    createdById: 'u1',
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  }
}

export function quickReply(
  overrides: Partial<WhatsAppQuickReplyDTO> = {},
): WhatsAppQuickReplyDTO {
  return {
    id: 'q1',
    workspaceId: 'ws1',
    shortcut: 'oi',
    title: 'Saudação',
    body: 'Olá! Como posso ajudar?',
    mediaUrl: null,
    buttons: [],
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  }
}

export function broadcast(
  overrides: Partial<WhatsAppBroadcastListDetailDTO> = {},
): WhatsAppBroadcastListDetailDTO {
  return {
    id: 'b1',
    workspaceId: 'ws1',
    connectionId: 'cn1',
    name: 'Promoção',
    messageBody: 'Novidades!',
    mediaUrl: null,
    mediaType: null,
    mediaFileName: null,
    status: 'DRAFT',
    scheduledAt: null,
    createdById: 'u1',
    recipientCount: 10,
    sentCount: 6,
    failedCount: 1,
    skippedCount: 1,
    createdAt: ISO,
    updatedAt: ISO,
    recipients: [],
    ...overrides,
  }
}

export function group(
  overrides: Partial<WhatsAppGroupDTO> = {},
): WhatsAppGroupDTO {
  return {
    id: 'g1',
    workspaceId: 'ws1',
    connectionId: 'cn1',
    groupJid: '123@g.us',
    name: 'Clientes VIP',
    imageUrl: null,
    description: null,
    inviteLink: null,
    archived: false,
    lastMessageAt: null,
    lastMessagePreview: null,
    participants: [],
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  }
}

export function template(
  overrides: Partial<WhatsAppTemplateDTO> = {},
): WhatsAppTemplateDTO {
  return {
    id: 't1',
    workspaceId: 'ws1',
    connectionId: 'cn1',
    name: 'boas_vindas',
    language: 'pt_BR',
    category: 'UTILITY',
    status: 'APPROVED',
    components: [{ type: 'BODY', text: 'Olá {{1}}' }],
    quality: 'UNKNOWN',
    qualityUpdatedAt: null,
    statusReason: null,
    headerFormat: null,
    headerMediaUrl: null,
    buttons: [],
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  }
}

export const members = [
  { id: 'u1', name: 'Ana', email: 'ana@x.com', image: null },
  { id: 'u2', name: 'Bruno', email: 'bruno@x.com', image: null },
]

/** The tool's preview, failing loudly if a write tool lacks one. */
export function previewOf<A>(tool: SteelAiTool<A>) {
  const preview = tool.preview
  if (!preview) throw new Error(`${tool.name} has no preview`)
  return (context: AiToolContext, args: A) => preview.call(tool, context, args)
}
