import type { Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Bulk reads for the Comunicação (WhatsApp) dashboard sources. Prisma only:
 * the window and ceilings come from the service, and the flattening and
 * derivation (labels, answer, stage) live in the mapper.
 */

const NAME = { select: { name: true } } as const

/** `IN (...)` lists are chunked to stay far from the bind-parameter limit. */
const IN_CHUNK = 5_000

/** Ceiling of answered conversations and of button answers read per call. */
export const WA_DASHBOARD_CONVERSATION_LIMIT = 50_000
export const WA_DASHBOARD_BUTTON_REPLY_LIMIT = 50_000

export const WA_DASHBOARD_RECIPIENT_SELECT = {
  id: true,
  status: true,
  conversationId: true,
  providerMessageId: true,
  sentAt: true,
  repliedAt: true,
  createdAt: true,
  campaign: { select: { name: true, status: true } },
  contact: { select: { waId: true } },
} as const satisfies Prisma.WhatsAppAiCampaignRecipientSelect

export type WaDashboardRecipient =
  Prisma.WhatsAppAiCampaignRecipientGetPayload<{
    select: typeof WA_DASHBOARD_RECIPIENT_SELECT
  }>

export const WA_DASHBOARD_CONVERSATION_SELECT = {
  id: true,
  status: true,
  assignedUserId: true,
  aiHandoff: true,
  closeOutcome: true,
  closeStatusLabels: true,
  closedAt: true,
  lastInboundAt: true,
  assignedUser: NAME,
  team: NAME,
  contact: { select: { waId: true } },
} as const satisfies Prisma.WhatsAppConversationSelect

export type WaDashboardConversation = Prisma.WhatsAppConversationGetPayload<{
  select: typeof WA_DASHBOARD_CONVERSATION_SELECT
}>

/** A button the contact clicked (text of the button, oldest first). */
export interface WaDashboardButtonReply {
  conversationId: string
  text: string | null
  createdAt: Date
}

/** Last message a human attendant wrote in a conversation. */
export interface WaDashboardHumanReply {
  conversationId: string
  lastAt: Date
}

/** Provider status of a campaign template, by provider message id. */
export interface WaDashboardDelivery {
  providerMessageId: string
  status: string
}

export interface WaAiCampaignRecipientData {
  recipients: WaDashboardRecipient[]
  /** Conversations of the workspace the contact wrote in since `since`. */
  conversations: WaDashboardConversation[]
  buttonReplies: WaDashboardButtonReply[]
  humanReplies: WaDashboardHumanReply[]
  deliveries: WaDashboardDelivery[]
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

export const WhatsAppDashboardSourceRepository = {
  /**
   * Recipients of the AI campaigns of the workspace (archived campaigns
   * included: they are history) created since `since`, newest first, up to
   * `limit`, with what is needed to tell who answered what: the answered
   * conversations of the workspace, the button clicks, the last human
   * message per conversation and the provider status of each template.
   */
  async aiCampaignRecipientData(
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<Result<WaAiCampaignRecipientData>> {
    try {
      const recipients = await prisma.whatsAppAiCampaignRecipient.findMany({
        where: { campaign: { workspaceId }, createdAt: { gte: since } },
        select: WA_DASHBOARD_RECIPIENT_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      })
      if (recipients.length === 0) {
        return ok({
          recipients,
          conversations: [],
          buttonReplies: [],
          humanReplies: [],
          deliveries: [],
        })
      }

      const providerIds = recipients
        .map((recipient) => recipient.providerMessageId)
        .filter((id): id is string => id !== null)

      const [conversations, buttonReplies, humanReplies, deliveries] =
        await Promise.all([
          prisma.whatsAppConversation.findMany({
            where: {
              workspaceId,
              deletedAt: null,
              lastInboundAt: { gte: since },
            },
            select: WA_DASHBOARD_CONVERSATION_SELECT,
            orderBy: { lastInboundAt: 'desc' },
            take: WA_DASHBOARD_CONVERSATION_LIMIT,
          }),
          prisma.whatsAppMessage.findMany({
            where: {
              workspaceId,
              direction: 'IN',
              type: 'BUTTON',
              deletedAt: null,
              createdAt: { gte: since },
            },
            select: { conversationId: true, text: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
            take: WA_DASHBOARD_BUTTON_REPLY_LIMIT,
          }),
          prisma.whatsAppMessage.groupBy({
            by: ['conversationId'],
            where: {
              workspaceId,
              direction: 'OUT',
              sentByAi: false,
              senderUserId: { not: null },
              deletedAt: null,
              createdAt: { gte: since },
            },
            _max: { createdAt: true },
          }),
          Promise.all(
            chunks(providerIds, IN_CHUNK).map((ids) =>
              prisma.whatsAppMessage.findMany({
                where: { workspaceId, providerMessageId: { in: ids } },
                select: { providerMessageId: true, status: true },
              }),
            ),
          ),
        ])

      return ok({
        recipients,
        conversations,
        buttonReplies,
        humanReplies: humanReplies.flatMap((row) =>
          row._max.createdAt
            ? [
                {
                  conversationId: row.conversationId,
                  lastAt: row._max.createdAt,
                },
              ]
            : [],
        ),
        deliveries: deliveries.flat().flatMap((message) =>
          message.providerMessageId
            ? [
                {
                  providerMessageId: message.providerMessageId,
                  status: message.status,
                },
              ]
            : [],
        ),
      })
    } catch (error) {
      return err(
        dbError('Failed to load the AI campaign recipients source', error),
      )
    }
  },
}
