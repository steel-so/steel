import type { Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Bulk reads for the channel sources of the Comunicação dashboards (calls,
 * charges, appointments, chatbot, flows, ads, contact base). Prisma only:
 * the window and ceilings come from the service, labels and derived fields
 * live in the mapper. No select reads a contact name, phone or document.
 */

const NAME = { select: { name: true } } as const

/** Team and number of the conversation a record belongs to. */
const CONVERSATION_ORIGIN = {
  select: { team: NAME, connection: { select: { label: true } } },
} as const

/** `IN (...)` lists are chunked to stay far from the bind-parameter limit. */
const IN_CHUNK = 5_000

export const WA_DASHBOARD_CALL_SELECT = {
  id: true,
  status: true,
  direction: true,
  source: true,
  voiceAgent: true,
  recordingKey: true,
  sentiment: true,
  durationSeconds: true,
  answeredAt: true,
  endedAt: true,
  createdAt: true,
  user: NAME,
  conversation: CONVERSATION_ORIGIN,
} as const satisfies Prisma.WhatsAppPhoneCallSelect

export type WaDashboardCall = Prisma.WhatsAppPhoneCallGetPayload<{
  select: typeof WA_DASHBOARD_CALL_SELECT
}>

export const WA_DASHBOARD_PIX_CHARGE_SELECT = {
  id: true,
  status: true,
  amount: true,
  paidAmount: true,
  createdById: true,
  createdByAi: true,
  expiresAt: true,
  paidAt: true,
  createdAt: true,
} as const satisfies Prisma.WhatsAppPixChargeSelect

export type WaDashboardPixCharge = Prisma.WhatsAppPixChargeGetPayload<{
  select: typeof WA_DASHBOARD_PIX_CHARGE_SELECT
}>

export const WA_DASHBOARD_BOLETO_CHARGE_SELECT = {
  id: true,
  status: true,
  amount: true,
  paidAmount: true,
  createdById: true,
  dueAt: true,
  paidAt: true,
  createdAt: true,
} as const satisfies Prisma.WhatsAppBoletoChargeSelect

export type WaDashboardBoletoCharge = Prisma.WhatsAppBoletoChargeGetPayload<{
  select: typeof WA_DASHBOARD_BOLETO_CHARGE_SELECT
}>

/** Name of a workspace user, for the ids that have no Prisma relation. */
export interface WaDashboardUserName {
  id: string
  name: string
}

export interface WaChargeData {
  pixCharges: WaDashboardPixCharge[]
  boletoCharges: WaDashboardBoletoCharge[]
  users: WaDashboardUserName[]
}

export const WA_DASHBOARD_APPOINTMENT_SELECT = {
  id: true,
  status: true,
  source: true,
  startsAt: true,
  endsAt: true,
  canceledAt: true,
  createdAt: true,
  service: NAME,
  professional: NAME,
} as const satisfies Prisma.WhatsAppSchedAppointmentSelect

export type WaDashboardAppointment = Prisma.WhatsAppSchedAppointmentGetPayload<{
  select: typeof WA_DASHBOARD_APPOINTMENT_SELECT
}>

export const WA_DASHBOARD_CHATBOT_SESSION_SELECT = {
  id: true,
  status: true,
  endReason: true,
  startedAt: true,
  lastActivityAt: true,
  endedAt: true,
  chatbot: NAME,
  conversation: CONVERSATION_ORIGIN,
} as const satisfies Prisma.WhatsAppChatbotSessionSelect

export type WaDashboardChatbotSession =
  Prisma.WhatsAppChatbotSessionGetPayload<{
    select: typeof WA_DASHBOARD_CHATBOT_SESSION_SELECT
  }>

/** `answers` is left out on purpose: free-form, may hold personal data. */
export const WA_DASHBOARD_FLOW_RESPONSE_SELECT = {
  id: true,
  status: true,
  sentByUserId: true,
  createdLeadId: true,
  createdPersonId: true,
  createdCompanyId: true,
  sentAt: true,
  respondedAt: true,
  flow: { select: { name: true, category: true } },
} as const satisfies Prisma.WhatsAppFlowResponseSelect

export type WaDashboardFlowResponse = Prisma.WhatsAppFlowResponseGetPayload<{
  select: typeof WA_DASHBOARD_FLOW_RESPONSE_SELECT
}>

export interface WaFlowResponseData {
  responses: WaDashboardFlowResponse[]
  users: WaDashboardUserName[]
}

export const WA_DASHBOARD_AD_REFERRAL_SELECT = {
  id: true,
  sourceType: true,
  sourceId: true,
  headline: true,
  mediaType: true,
  conversationId: true,
  leadId: true,
  receivedAt: true,
} as const satisfies Prisma.WhatsAppAdReferralSelect

export type WaDashboardAdReferral = Prisma.WhatsAppAdReferralGetPayload<{
  select: typeof WA_DASHBOARD_AD_REFERRAL_SELECT
}>

export const WA_DASHBOARD_REFERRAL_CONVERSATION_SELECT = {
  id: true,
  team: NAME,
  connection: { select: { label: true } },
} as const satisfies Prisma.WhatsAppConversationSelect

export type WaDashboardReferralConversation =
  Prisma.WhatsAppConversationGetPayload<{
    select: typeof WA_DASHBOARD_REFERRAL_CONVERSATION_SELECT
  }>

export interface WaAdReferralData {
  referrals: WaDashboardAdReferral[]
  /** Conversations the referrals arrived in (the model has no relation). */
  conversations: WaDashboardReferralConversation[]
}

export const WA_DASHBOARD_AD_SPEND_SELECT = {
  id: true,
  sourceId: true,
  label: true,
  periodStart: true,
  periodEnd: true,
  amount: true,
  createdAt: true,
} as const satisfies Prisma.WhatsAppAdSpendSelect

export type WaDashboardAdSpend = Prisma.WhatsAppAdSpendGetPayload<{
  select: typeof WA_DASHBOARD_AD_SPEND_SELECT
}>

/** No `waId`, `name`, `username` or `avatarUrl`: the base is counted only. */
export const WA_DASHBOARD_CONTACT_SELECT = {
  id: true,
  hasWhatsapp: true,
  broadcastOptedOutAt: true,
  broadcastOptOutSource: true,
  crmPersonId: true,
  createdAt: true,
  blocks: { select: { id: true }, take: 1 },
} as const satisfies Prisma.WhatsAppContactSelect

export type WaDashboardContact = Prisma.WhatsAppContactGetPayload<{
  select: typeof WA_DASHBOARD_CONTACT_SELECT
}>

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

function distinctIds(ids: Array<string | null>): string[] {
  return [...new Set(ids.filter((id): id is string => id !== null))]
}

async function userNames(ids: string[]): Promise<WaDashboardUserName[]> {
  const pages = await Promise.all(
    chunks(ids, IN_CHUNK).map((page) =>
      prisma.user.findMany({
        where: { id: { in: page } },
        select: { id: true, name: true },
      }),
    ),
  )
  return pages.flat()
}

export const WhatsAppDashboardChannelsRepository = {
  /** Phone calls placed or received since `since`, newest first. */
  async calls(
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<Result<WaDashboardCall[]>> {
    try {
      const rows = await prisma.whatsAppPhoneCall.findMany({
        where: { workspaceId, createdAt: { gte: since } },
        select: WA_DASHBOARD_CALL_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to load the calls source', error))
    }
  },

  /**
   * Pix and boleto charges created since `since` (up to `limit` of each,
   * newest first) with the names of the users that created them.
   */
  async chargeData(
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<Result<WaChargeData>> {
    try {
      const where = { workspaceId, createdAt: { gte: since } }
      const [pixCharges, boletoCharges] = await Promise.all([
        prisma.whatsAppPixCharge.findMany({
          where,
          select: WA_DASHBOARD_PIX_CHARGE_SELECT,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit,
        }),
        prisma.whatsAppBoletoCharge.findMany({
          where,
          select: WA_DASHBOARD_BOLETO_CHARGE_SELECT,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit,
        }),
      ])
      const users = await userNames(
        distinctIds([
          ...pixCharges.map((charge) => charge.createdById),
          ...boletoCharges.map((charge) => charge.createdById),
        ]),
      )
      return ok({ pixCharges, boletoCharges, users })
    } catch (error) {
      return err(dbError('Failed to load the charges source', error))
    }
  },

  /**
   * Appointments that start since `since` (future ones included), latest
   * start first.
   */
  async appointments(
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<Result<WaDashboardAppointment[]>> {
    try {
      const rows = await prisma.whatsAppSchedAppointment.findMany({
        where: { workspaceId, startsAt: { gte: since } },
        select: WA_DASHBOARD_APPOINTMENT_SELECT,
        orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
        take: limit,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to load the appointments source', error))
    }
  },

  /** Chatbot sessions started since `since`, newest first. */
  async chatbotSessions(
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<Result<WaDashboardChatbotSession[]>> {
    try {
      const rows = await prisma.whatsAppChatbotSession.findMany({
        where: { workspaceId, startedAt: { gte: since } },
        select: WA_DASHBOARD_CHATBOT_SESSION_SELECT,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take: limit,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to load the chatbot sessions source', error))
    }
  },

  /**
   * Flow sends since `since`, newest first, with the names of the users
   * that sent them. The answers payload is never read.
   */
  async flowResponseData(
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<Result<WaFlowResponseData>> {
    try {
      const responses = await prisma.whatsAppFlowResponse.findMany({
        where: { workspaceId, sentAt: { gte: since } },
        select: WA_DASHBOARD_FLOW_RESPONSE_SELECT,
        orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
        take: limit,
      })
      const users = await userNames(
        distinctIds(responses.map((response) => response.sentByUserId)),
      )
      return ok({ responses, users })
    } catch (error) {
      return err(dbError('Failed to load the flow responses source', error))
    }
  },

  /**
   * Ad referrals received since `since`, newest first, with the team and
   * number of the conversations they arrived in.
   */
  async adReferralData(
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<Result<WaAdReferralData>> {
    try {
      const referrals = await prisma.whatsAppAdReferral.findMany({
        where: { workspaceId, receivedAt: { gte: since } },
        select: WA_DASHBOARD_AD_REFERRAL_SELECT,
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        take: limit,
      })
      const conversationIds = distinctIds(
        referrals.map((referral) => referral.conversationId),
      )
      const conversations = await Promise.all(
        chunks(conversationIds, IN_CHUNK).map((ids) =>
          prisma.whatsAppConversation.findMany({
            where: { workspaceId, id: { in: ids } },
            select: WA_DASHBOARD_REFERRAL_CONVERSATION_SELECT,
          }),
        ),
      )
      return ok({ referrals, conversations: conversations.flat() })
    } catch (error) {
      return err(dbError('Failed to load the ad referrals source', error))
    }
  },

  /**
   * Ad spends whose period ends since `since` (a period that only partly
   * falls in the window still counts), latest period first.
   */
  async adSpends(
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<Result<WaDashboardAdSpend[]>> {
    try {
      const rows = await prisma.whatsAppAdSpend.findMany({
        where: { workspaceId, periodEnd: { gte: since } },
        select: WA_DASHBOARD_AD_SPEND_SELECT,
        orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
        take: limit,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to load the ad spends source', error))
    }
  },

  /** Contacts created since `since`, newest first, without identity. */
  async contacts(
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<Result<WaDashboardContact[]>> {
    try {
      const rows = await prisma.whatsAppContact.findMany({
        where: { workspaceId, createdAt: { gte: since } },
        select: WA_DASHBOARD_CONTACT_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to load the contacts source', error))
    }
  },
}
