import type { Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Bulk reads for the messaging sources of the Comunicação (WhatsApp)
 * dashboards: messages, broadcast recipients, templates, message costs and
 * AI campaign actions. Prisma only: the window and ceilings come from the
 * service, and the labels and derived fields live in the mapper. No select
 * reads the contact (name, phone, `waId`) nor the text of a message.
 */

const NAME = { select: { name: true } } as const

/** `IN (...)` lists are chunked to stay far from the bind-parameter limit. */
const IN_CHUNK = 5_000

export const WA_DASHBOARD_MESSAGE_SELECT = {
  id: true,
  direction: true,
  type: true,
  status: true,
  senderUserId: true,
  sentByAi: true,
  sentiment: true,
  sentimentScore: true,
  failureReason: true,
  createdAt: true,
  senderUser: NAME,
  conversation: {
    select: {
      connection: { select: { label: true, provider: true } },
      team: NAME,
      aiCampaign: NAME,
    },
  },
} as const satisfies Prisma.WhatsAppMessageSelect

export type WaDashboardMessage = Prisma.WhatsAppMessageGetPayload<{
  select: typeof WA_DASHBOARD_MESSAGE_SELECT
}>

export const WA_DASHBOARD_BROADCAST_RECIPIENT_SELECT = {
  id: true,
  status: true,
  providerMessageId: true,
  errorMessage: true,
  scheduledAt: true,
  sentAt: true,
  viaMarketingLite: true,
  createdAt: true,
  broadcastList: {
    select: {
      name: true,
      status: true,
      template: NAME,
      connection: { select: { label: true } },
    },
  },
} as const satisfies Prisma.WhatsAppBroadcastRecipientSelect

export type WaDashboardBroadcastRecipient =
  Prisma.WhatsAppBroadcastRecipientGetPayload<{
    select: typeof WA_DASHBOARD_BROADCAST_RECIPIENT_SELECT
  }>

/** Provider status of a sent message, by provider message id. */
export interface WaDashboardMessageDelivery {
  providerMessageId: string
  status: string
}

export interface WaBroadcastRecipientData {
  recipients: WaDashboardBroadcastRecipient[]
  deliveries: WaDashboardMessageDelivery[]
}

export const WA_DASHBOARD_TEMPLATE_SELECT = {
  id: true,
  name: true,
  language: true,
  category: true,
  status: true,
  quality: true,
  headerFormat: true,
  components: true,
  buttons: true,
  createdAt: true,
  updatedAt: true,
  connection: { select: { label: true } },
} as const satisfies Prisma.WhatsAppTemplateSelect

export type WaDashboardTemplate = Prisma.WhatsAppTemplateGetPayload<{
  select: typeof WA_DASHBOARD_TEMPLATE_SELECT
}>

export const WA_DASHBOARD_COST_SELECT = {
  id: true,
  provider: true,
  occurredAt: true,
  category: true,
  kind: true,
  source: true,
  currency: true,
  broadcastId: true,
  aiCampaignId: true,
  quantity: true,
  unitPrice: true,
  estimatedCost: true,
  viaMarketingLite: true,
  reversedAt: true,
  connection: { select: { label: true } },
} as const satisfies Prisma.WhatsAppCostEntrySelect

export type WaDashboardCost = Prisma.WhatsAppCostEntryGetPayload<{
  select: typeof WA_DASHBOARD_COST_SELECT
}>

export interface WaDashboardNamed {
  id: string
  name: string
}

export interface WaCostData {
  entries: WaDashboardCost[]
  /** Broadcast lists and AI campaigns the entries point to. */
  broadcasts: WaDashboardNamed[]
  aiCampaigns: WaDashboardNamed[]
}

export const WA_DASHBOARD_ACTION_RUN_SELECT = {
  id: true,
  kind: true,
  label: true,
  status: true,
  error: true,
  createdAt: true,
  campaign: NAME,
} as const satisfies Prisma.WhatsAppAiCampaignActionRunSelect

export type WaDashboardActionRun =
  Prisma.WhatsAppAiCampaignActionRunGetPayload<{
    select: typeof WA_DASHBOARD_ACTION_RUN_SELECT
  }>

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

function distinct(ids: (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== null))]
}

export const WhatsAppDashboardMessagingRepository = {
  /**
   * Non-deleted messages of the one-to-one conversations of the workspace
   * created since `since`, newest first, up to `limit` (group messages live
   * in another model and stay out).
   */
  async messages(
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<Result<WaDashboardMessage[]>> {
    try {
      const messages = await prisma.whatsAppMessage.findMany({
        where: { workspaceId, deletedAt: null, createdAt: { gte: since } },
        select: WA_DASHBOARD_MESSAGE_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      })
      return ok(messages)
    } catch (error) {
      return err(dbError('Failed to load the messages source', error))
    }
  },

  /**
   * Recipients of the broadcast lists of the workspace created since
   * `since`, newest first, up to `limit`, with the provider status of the
   * messages that were sent.
   */
  async broadcastRecipientData(
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<Result<WaBroadcastRecipientData>> {
    try {
      const recipients = await prisma.whatsAppBroadcastRecipient.findMany({
        where: { broadcastList: { workspaceId }, createdAt: { gte: since } },
        select: WA_DASHBOARD_BROADCAST_RECIPIENT_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      })
      const providerIds = distinct(
        recipients.map((recipient) => recipient.providerMessageId),
      )
      const deliveries = await Promise.all(
        chunks(providerIds, IN_CHUNK).map((ids) =>
          prisma.whatsAppMessage.findMany({
            where: { workspaceId, providerMessageId: { in: ids } },
            select: { providerMessageId: true, status: true },
          }),
        ),
      )
      return ok({
        recipients,
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
        dbError('Failed to load the broadcast recipients source', error),
      )
    }
  },

  /**
   * Message templates of the workspace as they are now (no window), most
   * recently updated first, up to `limit`.
   */
  async templates(
    workspaceId: string,
    limit: number,
  ): Promise<Result<WaDashboardTemplate[]>> {
    try {
      const templates = await prisma.whatsAppTemplate.findMany({
        where: { workspaceId },
        select: WA_DASHBOARD_TEMPLATE_SELECT,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: limit,
      })
      return ok(templates)
    } catch (error) {
      return err(dbError('Failed to load the templates source', error))
    }
  },

  /**
   * Entries of the message cost ledger of the workspace since `since`,
   * newest first, up to `limit`, with the names of the broadcast lists and
   * AI campaigns they point to (plain ids on the entry, no relation).
   */
  async costData(
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<Result<WaCostData>> {
    try {
      const entries = await prisma.whatsAppCostEntry.findMany({
        where: { workspaceId, occurredAt: { gte: since } },
        select: WA_DASHBOARD_COST_SELECT,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: limit,
      })
      const broadcastIds = distinct(entries.map((entry) => entry.broadcastId))
      const aiCampaignIds = distinct(entries.map((entry) => entry.aiCampaignId))
      const [broadcasts, aiCampaigns] = await Promise.all([
        Promise.all(
          chunks(broadcastIds, IN_CHUNK).map((ids) =>
            prisma.whatsAppBroadcastList.findMany({
              where: { workspaceId, id: { in: ids } },
              select: { id: true, name: true },
            }),
          ),
        ),
        Promise.all(
          chunks(aiCampaignIds, IN_CHUNK).map((ids) =>
            prisma.whatsAppAiCampaign.findMany({
              where: { workspaceId, id: { in: ids } },
              select: { id: true, name: true },
            }),
          ),
        ),
      ])
      return ok({
        entries,
        broadcasts: broadcasts.flat(),
        aiCampaigns: aiCampaigns.flat(),
      })
    } catch (error) {
      return err(dbError('Failed to load the message costs source', error))
    }
  },

  /**
   * Actions the AI ran in the AI campaigns of the workspace since `since`,
   * newest first, up to `limit`.
   */
  async aiCampaignActionRuns(
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<Result<WaDashboardActionRun[]>> {
    try {
      const runs = await prisma.whatsAppAiCampaignActionRun.findMany({
        where: { workspaceId, createdAt: { gte: since } },
        select: WA_DASHBOARD_ACTION_RUN_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      })
      return ok(runs)
    } catch (error) {
      return err(
        dbError('Failed to load the AI campaign actions source', error),
      )
    }
  },
}
