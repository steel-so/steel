import type {
  WhatsAppChatbot,
  WhatsAppChatbotSession,
  WhatsAppContact,
} from '@prisma/client'
import { parseChatbotState } from '@/src/lib/whatsapp/chatbot/engine'
import {
  type ChatbotFlow,
  ChatbotFlowSchema,
} from '@/src/schemas/whatsapp-chatbot.schema'
import type {
  WhatsAppChatbotDTO,
  WhatsAppChatbotListItemDTO,
  WhatsAppChatbotSessionDTO,
  WhatsAppChatbotStatsDTO,
} from '@/types/whatsapp-chatbot'

const EMPTY_FLOW: ChatbotFlow = { nodes: [], edges: [] }

/** Reads a flow column; anything malformed reads as an empty flow. */
export function parseStoredFlow(value: unknown): ChatbotFlow {
  const parsed = ChatbotFlowSchema.safeParse(value)
  return parsed.success ? parsed.data : EMPTY_FLOW
}

export function emptyChatbotStats(): WhatsAppChatbotStatsDTO {
  return {
    sessions: 0,
    running: 0,
    completed: 0,
    handedOffHuman: 0,
    handedOffAi: 0,
    expired: 0,
    cancelled: 0,
    failed: 0,
  }
}

export function toWhatsAppChatbotDTO(bot: WhatsAppChatbot): WhatsAppChatbotDTO {
  const flow = parseStoredFlow(bot.draft)
  return {
    id: bot.id,
    workspaceId: bot.workspaceId,
    connectionId: bot.connectionId,
    name: bot.name,
    description: bot.description,
    status: bot.status,
    triggerKind: bot.triggerKind,
    keywords: bot.keywords,
    sessionTtlMinutes: bot.sessionTtlMinutes,
    flow,
    publishedVersion: bot.publishedVersion,
    publishedAt: bot.publishedAt?.toISOString() ?? null,
    hasUnpublishedChanges:
      bot.published === null ||
      JSON.stringify(parseStoredFlow(bot.published)) !== JSON.stringify(flow),
    createdAt: bot.createdAt.toISOString(),
    updatedAt: bot.updatedAt.toISOString(),
  }
}

export function toWhatsAppChatbotListItemDTO(
  bot: WhatsAppChatbot,
  stats: WhatsAppChatbotStatsDTO,
): WhatsAppChatbotListItemDTO {
  const { flow, ...rest } = toWhatsAppChatbotDTO(bot)
  return { ...rest, nodeCount: flow.nodes.length, stats }
}

export function toWhatsAppChatbotSessionDTO(
  session: WhatsAppChatbotSession & {
    conversation?: { contact: Pick<WhatsAppContact, 'name' | 'waId'> } | null
  },
): WhatsAppChatbotSessionDTO {
  return {
    id: session.id,
    chatbotId: session.chatbotId,
    conversationId: session.conversationId,
    contactName: session.conversation?.contact.name ?? null,
    contactPhone: session.conversation?.contact.waId ?? null,
    status: session.status,
    botVersion: session.botVersion,
    endReason: session.endReason,
    variables: parseChatbotState(session.state).variables,
    startedAt: session.startedAt.toISOString(),
    lastActivityAt: session.lastActivityAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
  }
}
