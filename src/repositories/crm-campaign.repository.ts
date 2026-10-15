import {
  type CrmCampaign,
  type CrmCampaignChannel,
  type CrmCampaignConversion,
  type CrmCampaignConversionKind,
  type CrmCampaignDeliveryStatus,
  type CrmCampaignRecipient,
  type CrmCampaignRunStatus,
  Prisma,
} from '@prisma/client'
import { crmCampaignNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export type CampaignChannelKey = 'email' | 'whatsapp'

export function channelKey(channel: CrmCampaignChannel): CampaignChannelKey {
  return channel === 'EMAIL' ? 'email' : 'whatsapp'
}

const STATUS_FIELD = {
  email: 'emailStatus',
  whatsapp: 'whatsappStatus',
} as const

export type CampaignRecipientInput = {
  personId: string | null
  leadId: string | null
  name: string
  email: string | null
  waId: string | null
  emailStatus: CrmCampaignDeliveryStatus
  emailSkipReason: string | null
  whatsappStatus: CrmCampaignDeliveryStatus
  whatsappSkipReason: string | null
}

/** Counts per campaign that feed the list KPIs and the dashboard funnel. */
export interface CampaignFunnelCounts {
  recipients: number
  email: Record<CrmCampaignDeliveryStatus, number> & {
    delivered: number
    opened: number
    clicked: number
    bounced: number
    unsubscribed: number
  }
  whatsapp: Record<CrmCampaignDeliveryStatus, number> & {
    delivered: number
    read: number
    clicked: number
    replied: number
  }
  conversions: number
}

const EMPTY_STATUS: Record<CrmCampaignDeliveryStatus, number> = {
  NONE: 0,
  PENDING: 0,
  SENDING: 0,
  SENT: 0,
  FAILED: 0,
  SKIPPED: 0,
}

function emptyFunnel(): CampaignFunnelCounts {
  return {
    recipients: 0,
    email: {
      ...EMPTY_STATUS,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      unsubscribed: 0,
    },
    whatsapp: {
      ...EMPTY_STATUS,
      delivered: 0,
      read: 0,
      clicked: 0,
      replied: 0,
    },
    conversions: 0,
  }
}

export const CrmCampaignRepository = {
  async listByWorkspace(workspaceId: string): Promise<Result<CrmCampaign[]>> {
    try {
      const campaigns = await prisma.crmCampaign.findMany({
        where: { workspaceId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      })
      return ok(campaigns)
    } catch (error) {
      return err(dbError('Failed to list CRM campaigns', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<CrmCampaign>> {
    try {
      const campaign = await prisma.crmCampaign.findFirst({
        where: { id, workspaceId, deletedAt: null },
      })
      if (!campaign) return err(crmCampaignNotFound())
      return ok(campaign)
    } catch (error) {
      return err(dbError('Failed to find CRM campaign', error))
    }
  },

  /** Worker lookup — no workspace scope (the job already carries the id). */
  async findByIdUnscoped(id: string): Promise<Result<CrmCampaign | null>> {
    try {
      const campaign = await prisma.crmCampaign.findFirst({
        where: { id, deletedAt: null },
      })
      return ok(campaign)
    } catch (error) {
      return err(dbError('Failed to find CRM campaign', error))
    }
  },

  async findBySlug(
    workspaceId: string,
    slug: string,
  ): Promise<Result<CrmCampaign | null>> {
    try {
      const campaign = await prisma.crmCampaign.findFirst({
        where: { workspaceId, slug, deletedAt: null },
      })
      return ok(campaign)
    } catch (error) {
      return err(dbError('Failed to find CRM campaign by slug', error))
    }
  },

  /** Slugs already taken in the workspace that start with `base`. */
  async listSlugsLike(
    workspaceId: string,
    base: string,
  ): Promise<Result<string[]>> {
    try {
      const rows = await prisma.crmCampaign.findMany({
        where: { workspaceId, slug: { startsWith: base } },
        select: { slug: true },
      })
      return ok(rows.map((row) => row.slug))
    } catch (error) {
      return err(dbError('Failed to list CRM campaign slugs', error))
    }
  },

  async create(data: {
    workspaceId: string
    createdById: string
    name: string
    slug: string
  }): Promise<Result<CrmCampaign>> {
    try {
      const campaign = await prisma.crmCampaign.create({ data })
      return ok(campaign)
    } catch (error) {
      return err(dbError('Failed to create CRM campaign', error))
    }
  },

  async update(
    id: string,
    data: Prisma.CrmCampaignUncheckedUpdateInput,
  ): Promise<Result<CrmCampaign>> {
    try {
      const campaign = await prisma.crmCampaign.update({ where: { id }, data })
      return ok(campaign)
    } catch (error) {
      return err(dbError('Failed to update CRM campaign', error))
    }
  },

  async softDelete(id: string): Promise<Result<void>> {
    try {
      await prisma.crmCampaign.update({
        where: { id },
        data: { deletedAt: new Date() },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM campaign', error))
    }
  },

  /**
   * Conditional status change: applies only while the campaign is in one of
   * `from`, so concurrent callers (two ticks, a tick and a pause) never both
   * win. Returns the updated row, or `null` when the guard did not match.
   */
  async transition(
    id: string,
    from: CrmCampaignRunStatus[],
    data: Prisma.CrmCampaignUncheckedUpdateManyInput,
  ): Promise<Result<CrmCampaign | null>> {
    try {
      const updated = await prisma.crmCampaign.updateMany({
        where: { id, status: { in: from } },
        data,
      })
      if (updated.count === 0) return ok(null)
      const campaign = await prisma.crmCampaign.findUnique({ where: { id } })
      return ok(campaign)
    } catch (error) {
      return err(dbError('Failed to transition CRM campaign', error))
    }
  },

  /** Campaigns the worker tick must look at (cross-workspace). */
  async listRunnable(now: Date): Promise<Result<CrmCampaign[]>> {
    try {
      const campaigns = await prisma.crmCampaign.findMany({
        where: {
          deletedAt: null,
          OR: [
            { status: 'SENDING' },
            { status: 'SCHEDULED', startAt: { lte: now } },
          ],
        },
      })
      return ok(campaigns)
    } catch (error) {
      return err(dbError('Failed to list runnable CRM campaigns', error))
    }
  },

  async funnel(
    campaignIds: string[],
  ): Promise<Result<Map<string, CampaignFunnelCounts>>> {
    const result = new Map<string, CampaignFunnelCounts>()
    if (campaignIds.length === 0) return ok(result)
    for (const id of campaignIds) result.set(id, emptyFunnel())
    try {
      const where = { campaignId: { in: campaignIds } }
      const [timestamps, emailStatus, whatsappStatus, conversions] =
        await Promise.all([
          prisma.crmCampaignRecipient.groupBy({
            by: ['campaignId'],
            where,
            _count: {
              _all: true,
              emailDeliveredAt: true,
              emailOpenedAt: true,
              emailClickedAt: true,
              emailBouncedAt: true,
              unsubscribedAt: true,
              whatsappDeliveredAt: true,
              whatsappReadAt: true,
              whatsappClickedAt: true,
              whatsappRepliedAt: true,
            },
          }),
          prisma.crmCampaignRecipient.groupBy({
            by: ['campaignId', 'emailStatus'],
            where,
            _count: { _all: true },
          }),
          prisma.crmCampaignRecipient.groupBy({
            by: ['campaignId', 'whatsappStatus'],
            where,
            _count: { _all: true },
          }),
          prisma.crmCampaignConversion.groupBy({
            by: ['campaignId'],
            where,
            _count: { _all: true },
          }),
        ])

      for (const row of timestamps) {
        const funnel = result.get(row.campaignId) as CampaignFunnelCounts
        funnel.recipients = row._count._all
        funnel.email.delivered = row._count.emailDeliveredAt
        funnel.email.opened = row._count.emailOpenedAt
        funnel.email.clicked = row._count.emailClickedAt
        funnel.email.bounced = row._count.emailBouncedAt
        funnel.email.unsubscribed = row._count.unsubscribedAt
        funnel.whatsapp.delivered = row._count.whatsappDeliveredAt
        funnel.whatsapp.read = row._count.whatsappReadAt
        funnel.whatsapp.clicked = row._count.whatsappClickedAt
        funnel.whatsapp.replied = row._count.whatsappRepliedAt
      }
      for (const row of emailStatus) {
        const funnel = result.get(row.campaignId) as CampaignFunnelCounts
        funnel.email[row.emailStatus] = row._count._all
      }
      for (const row of whatsappStatus) {
        const funnel = result.get(row.campaignId) as CampaignFunnelCounts
        funnel.whatsapp[row.whatsappStatus] = row._count._all
      }
      for (const row of conversions) {
        const funnel = result.get(row.campaignId) as CampaignFunnelCounts
        funnel.conversions = row._count._all
      }
      return ok(result)
    } catch (error) {
      return err(dbError('Failed to count CRM campaign funnel', error))
    }
  },
}

export const CrmCampaignRecipientRepository = {
  async createMany(
    campaignId: string,
    workspaceId: string,
    rows: CampaignRecipientInput[],
  ): Promise<Result<number>> {
    try {
      const created = await prisma.crmCampaignRecipient.createMany({
        data: rows.map((row) => ({ ...row, campaignId, workspaceId })),
      })
      return ok(created.count)
    } catch (error) {
      return err(dbError('Failed to create CRM campaign recipients', error))
    }
  },

  async findById(id: string): Promise<Result<CrmCampaignRecipient | null>> {
    try {
      const recipient = await prisma.crmCampaignRecipient.findUnique({
        where: { id },
      })
      return ok(recipient)
    } catch (error) {
      return err(dbError('Failed to find CRM campaign recipient', error))
    }
  },

  async findWithCampaign(
    id: string,
  ): Promise<
    Result<(CrmCampaignRecipient & { campaign: CrmCampaign }) | null>
  > {
    try {
      const recipient = await prisma.crmCampaignRecipient.findUnique({
        where: { id },
        include: { campaign: true },
      })
      return ok(recipient)
    } catch (error) {
      return err(dbError('Failed to find CRM campaign recipient', error))
    }
  },

  async listPage(
    campaignId: string,
    query: { page: number; pageSize: number; search?: string },
  ): Promise<Result<{ items: CrmCampaignRecipient[]; total: number }>> {
    const where: Prisma.CrmCampaignRecipientWhereInput = {
      campaignId,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { waId: { contains: query.search.replace(/\D/g, '') || '-' } },
            ],
          }
        : {}),
    }
    try {
      const [items, total] = await Promise.all([
        prisma.crmCampaignRecipient.findMany({
          where,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.crmCampaignRecipient.count({ where }),
      ])
      return ok({ items, total })
    } catch (error) {
      return err(dbError('Failed to list CRM campaign recipients', error))
    }
  },

  async listPendingIds(
    campaignId: string,
    channel: CrmCampaignChannel,
    limit: number,
  ): Promise<Result<string[]>> {
    try {
      const rows = await prisma.crmCampaignRecipient.findMany({
        where: { campaignId, [STATUS_FIELD[channelKey(channel)]]: 'PENDING' },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: limit,
      })
      return ok(rows.map((row) => row.id))
    } catch (error) {
      return err(
        dbError('Failed to list pending CRM campaign recipients', error),
      )
    }
  },

  /** PENDING + SENDING of a channel — 0 means the channel is drained. */
  async countOpen(
    campaignId: string,
    channel: CrmCampaignChannel,
  ): Promise<Result<number>> {
    try {
      const count = await prisma.crmCampaignRecipient.count({
        where: {
          campaignId,
          [STATUS_FIELD[channelKey(channel)]]: { in: ['PENDING', 'SENDING'] },
        },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to count open CRM campaign recipients', error))
    }
  },

  /**
   * Idempotency guard: PENDING → SENDING only if still PENDING. `true` =
   * this caller owns the send; `false` = someone else did (or it is done).
   */
  async claim(
    id: string,
    channel: CrmCampaignChannel,
  ): Promise<Result<boolean>> {
    const field = STATUS_FIELD[channelKey(channel)]
    try {
      const updated = await prisma.crmCampaignRecipient.updateMany({
        where: { id, [field]: 'PENDING' },
        data: { [field]: 'SENDING' },
      })
      return ok(updated.count === 1)
    } catch (error) {
      return err(dbError('Failed to claim CRM campaign recipient', error))
    }
  },

  /** Gives a claimed row back (rate limited / campaign paused). */
  async release(
    id: string,
    channel: CrmCampaignChannel,
  ): Promise<Result<void>> {
    const field = STATUS_FIELD[channelKey(channel)]
    try {
      await prisma.crmCampaignRecipient.updateMany({
        where: { id, [field]: 'SENDING' },
        data: { [field]: 'PENDING' },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to release CRM campaign recipient', error))
    }
  },

  async markSent(
    id: string,
    channel: CrmCampaignChannel,
    providerMessageId: string,
    at: Date,
  ): Promise<Result<void>> {
    try {
      await prisma.crmCampaignRecipient.update({
        where: { id },
        data:
          channel === 'EMAIL'
            ? {
                emailStatus: 'SENT',
                emailProviderMessageId: providerMessageId,
                emailSentAt: at,
                emailError: null,
              }
            : {
                whatsappStatus: 'SENT',
                whatsappProviderMessageId: providerMessageId,
                whatsappSentAt: at,
                whatsappError: null,
              },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to mark CRM campaign recipient sent', error))
    }
  },

  async markFailed(
    id: string,
    channel: CrmCampaignChannel,
    message: string,
  ): Promise<Result<void>> {
    try {
      await prisma.crmCampaignRecipient.update({
        where: { id },
        data:
          channel === 'EMAIL'
            ? { emailStatus: 'FAILED', emailError: message.slice(0, 500) }
            : {
                whatsappStatus: 'FAILED',
                whatsappError: message.slice(0, 500),
              },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to mark CRM campaign recipient failed', error))
    }
  },

  async markSkipped(
    id: string,
    channel: CrmCampaignChannel,
    reason: string,
  ): Promise<Result<void>> {
    try {
      await prisma.crmCampaignRecipient.update({
        where: { id },
        data:
          channel === 'EMAIL'
            ? { emailStatus: 'SKIPPED', emailSkipReason: reason }
            : { whatsappStatus: 'SKIPPED', whatsappSkipReason: reason },
      })
      return ok(undefined)
    } catch (error) {
      return err(
        dbError('Failed to mark CRM campaign recipient skipped', error),
      )
    }
  },

  /** Cancel: every row still waiting on any channel becomes SKIPPED. */
  async skipAllOpen(campaignId: string): Promise<Result<number>> {
    try {
      const [email, whatsapp] = await prisma.$transaction([
        prisma.crmCampaignRecipient.updateMany({
          where: { campaignId, emailStatus: { in: ['PENDING', 'SENDING'] } },
          data: { emailStatus: 'SKIPPED', emailSkipReason: 'canceled' },
        }),
        prisma.crmCampaignRecipient.updateMany({
          where: { campaignId, whatsappStatus: { in: ['PENDING', 'SENDING'] } },
          data: { whatsappStatus: 'SKIPPED', whatsappSkipReason: 'canceled' },
        }),
      ])
      return ok(email.count + whatsapp.count)
    } catch (error) {
      return err(dbError('Failed to skip CRM campaign recipients', error))
    }
  },

  /** Rows stuck in SENDING (worker died mid-send) go back to PENDING. */
  async releaseStuck(olderThan: Date): Promise<Result<number>> {
    try {
      const [email, whatsapp] = await prisma.$transaction([
        prisma.crmCampaignRecipient.updateMany({
          where: { emailStatus: 'SENDING', updatedAt: { lt: olderThan } },
          data: { emailStatus: 'PENDING' },
        }),
        prisma.crmCampaignRecipient.updateMany({
          where: { whatsappStatus: 'SENDING', updatedAt: { lt: olderThan } },
          data: { whatsappStatus: 'PENDING' },
        }),
      ])
      return ok(email.count + whatsapp.count)
    } catch (error) {
      return err(
        dbError('Failed to release stuck CRM campaign recipients', error),
      )
    }
  },

  /** WhatsApp messages sent through a connection since `since` (tier cap). */
  async countWhatsAppSentSince(
    connectionId: string,
    since: Date,
  ): Promise<Result<number>> {
    try {
      const count = await prisma.crmCampaignRecipient.count({
        where: {
          whatsappSentAt: { gte: since },
          campaign: { whatsappConnectionId: connectionId },
        },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to count CRM campaign WhatsApp sends', error))
    }
  },

  /**
   * Sets a funnel timestamp only the first time (`field` still null).
   * Returns whether this call set it.
   */
  async markFirst(
    where: Prisma.CrmCampaignRecipientWhereInput,
    field:
      | 'emailDeliveredAt'
      | 'emailOpenedAt'
      | 'emailClickedAt'
      | 'emailBouncedAt'
      | 'unsubscribedAt'
      | 'whatsappDeliveredAt'
      | 'whatsappReadAt'
      | 'whatsappClickedAt'
      | 'convertedAt',
    at: Date,
  ): Promise<Result<boolean>> {
    try {
      const updated = await prisma.crmCampaignRecipient.updateMany({
        where: { ...where, [field]: null },
        data: { [field]: at },
      })
      return ok(updated.count > 0)
    } catch (error) {
      return err(dbError('Failed to update CRM campaign recipient', error))
    }
  },

  async findByProviderMessageId(
    channel: CrmCampaignChannel,
    providerMessageId: string,
  ): Promise<Result<CrmCampaignRecipient | null>> {
    try {
      const recipient = await prisma.crmCampaignRecipient.findUnique({
        where:
          channel === 'EMAIL'
            ? { emailProviderMessageId: providerMessageId }
            : { whatsappProviderMessageId: providerMessageId },
      })
      return ok(recipient)
    } catch (error) {
      return err(dbError('Failed to find CRM campaign recipient', error))
    }
  },

  /**
   * Recipients a WhatsApp reply from `waId` answers: sent recently, not yet
   * marked as replied, newest first.
   */
  async listAwaitingReply(
    workspaceId: string,
    waId: string,
    since: Date,
  ): Promise<Result<(CrmCampaignRecipient & { campaign: CrmCampaign })[]>> {
    try {
      const rows = await prisma.crmCampaignRecipient.findMany({
        where: {
          workspaceId,
          waId,
          whatsappSentAt: { gte: since },
          whatsappRepliedAt: null,
        },
        include: { campaign: true },
        orderBy: { whatsappSentAt: 'desc' },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list CRM campaign recipients', error))
    }
  },

  async markReplied(
    id: string,
    data: { at: Date; conversationId: string },
  ): Promise<Result<void>> {
    try {
      await prisma.crmCampaignRecipient.update({
        where: { id },
        data: {
          whatsappRepliedAt: data.at,
          conversationId: data.conversationId,
        },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to mark CRM campaign reply', error))
    }
  },
}

export type CampaignConversionInput = {
  campaignId: string
  recipientId: string | null
  channel: CrmCampaignChannel | null
  kind: CrmCampaignConversionKind
  sourceRef: string
  leadId?: string | null
  personId?: string | null
  siteId?: string | null
  sitePageId?: string | null
  formId?: string | null
}

/** Campaign conversions that happened on one site, per campaign. */
export interface SiteCampaignConversionRow {
  campaignId: string
  name: string
  slug: string
  views: number
  formSubmissions: number
}

export const CrmCampaignConversionRepository = {
  /** Idempotent by (campaign, kind, sourceRef): `null` when it already existed. */
  async record(
    data: CampaignConversionInput,
  ): Promise<Result<CrmCampaignConversion | null>> {
    try {
      const conversion = await prisma.crmCampaignConversion.create({ data })
      return ok(conversion)
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return ok(null)
      }
      return err(dbError('Failed to record CRM campaign conversion', error))
    }
  },

  async listRecent(
    campaignId: string,
    limit: number,
  ): Promise<
    Result<(CrmCampaignConversion & { recipient: { name: string } | null })[]>
  > {
    try {
      const rows = await prisma.crmCampaignConversion.findMany({
        where: { campaignId },
        include: { recipient: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list CRM campaign conversions', error))
    }
  },

  async countBy(campaignId: string): Promise<
    Result<
      {
        kind: CrmCampaignConversionKind
        channel: CrmCampaignChannel | null
        count: number
      }[]
    >
  > {
    try {
      const rows = await prisma.crmCampaignConversion.groupBy({
        by: ['kind', 'channel'],
        where: { campaignId },
        _count: { _all: true },
      })
      return ok(
        rows.map((row) => ({
          kind: row.kind,
          channel: row.channel,
          count: row._count._all,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to count CRM campaign conversions', error))
    }
  },

  /** Site analytics: conversions recorded on `siteId` in `[start, end)`,
   * grouped by campaign (deleted campaigns included — the traffic was real). */
  async countBySite(
    siteId: string,
    window: { start: Date; end: Date },
  ): Promise<Result<SiteCampaignConversionRow[]>> {
    try {
      const rows = await prisma.crmCampaignConversion.groupBy({
        by: ['campaignId', 'kind'],
        where: {
          siteId,
          kind: { in: ['SITE_VIEW', 'SITE_FORM_SUBMISSION'] },
          createdAt: { gte: window.start, lt: window.end },
        },
        _count: { _all: true },
      })
      if (rows.length === 0) return ok([])
      const campaigns = await prisma.crmCampaign.findMany({
        where: { id: { in: [...new Set(rows.map((row) => row.campaignId))] } },
        select: { id: true, name: true, slug: true },
      })
      const result = new Map<string, SiteCampaignConversionRow>()
      for (const campaign of campaigns) {
        result.set(campaign.id, {
          campaignId: campaign.id,
          name: campaign.name,
          slug: campaign.slug,
          views: 0,
          formSubmissions: 0,
        })
      }
      for (const row of rows) {
        const entry = result.get(row.campaignId)
        if (!entry) continue
        if (row.kind === 'SITE_VIEW') entry.views += row._count._all
        else entry.formSubmissions += row._count._all
      }
      return ok(
        [...result.values()].sort(
          (a, b) =>
            b.views + b.formSubmissions - (a.views + a.formSubmissions) ||
            a.name.localeCompare(b.name),
        ),
      )
    } catch (error) {
      return err(dbError('Failed to count site campaign conversions', error))
    }
  },
}
