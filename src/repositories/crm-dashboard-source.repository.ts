import type { Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Bulk reads for the CRM dashboard sources. Pure Prisma: the window and the
 * row ceiling come from the service, flattening and derived fields live in
 * the mapper. Every query is scoped by workspace and skips soft-deleted rows.
 */

const NAME = { select: { name: true } } as const

const PROPOSAL_SELECT = {
  id: true,
  name: true,
  status: true,
  responsibleId: true,
  validUntil: true,
  sentAt: true,
  acceptedAt: true,
  expiredAt: true,
  createdAt: true,
  responsible: NAME,
  company: NAME,
  contact: NAME,
  opportunity: { select: { name: true, amount: true } },
  sections: {
    where: { type: 'PRODUCTS_PRICING' },
    select: { content: true },
  },
  views: { select: { createdAt: true }, orderBy: { createdAt: 'asc' } },
} as const satisfies Prisma.CrmProposalSelect

export type CrmDashboardProposal = Prisma.CrmProposalGetPayload<{
  select: typeof PROPOSAL_SELECT
}>

const CONTRACT_SELECT = {
  id: true,
  name: true,
  status: true,
  ownerId: true,
  value: true,
  startDate: true,
  endDate: true,
  autoRenews: true,
  renewalOpportunityId: true,
  renewalCreatedAt: true,
  createdAt: true,
  company: NAME,
} as const satisfies Prisma.CrmContractSelect

export type CrmDashboardContract = Prisma.CrmContractGetPayload<{
  select: typeof CONTRACT_SELECT
}>

const CHARGE_SELECT = {
  id: true,
  method: true,
  provider: true,
  status: true,
  amount: true,
  paidAmount: true,
  createdById: true,
  expiresAt: true,
  paidAt: true,
  canceledAt: true,
  createdAt: true,
  proposal: { select: { name: true, company: NAME } },
} as const satisfies Prisma.CrmProposalChargeSelect

export type CrmDashboardCharge = Prisma.CrmProposalChargeGetPayload<{
  select: typeof CHARGE_SELECT
}>

const ACTIVITY_SELECT = {
  id: true,
  action: true,
  entity: true,
  actorUserId: true,
  summary: true,
  createdAt: true,
  actor: NAME,
} as const satisfies Prisma.CrmActivitySelect

export type CrmDashboardActivity = Prisma.CrmActivityGetPayload<{
  select: typeof ACTIVITY_SELECT
}>

const QUOTA_SELECT = {
  id: true,
  ownerId: true,
  period: true,
  periodKey: true,
  targetAmount: true,
  owner: NAME,
} as const satisfies Prisma.CrmQuotaSelect

export type CrmDashboardQuota = Prisma.CrmQuotaGetPayload<{
  select: typeof QUOTA_SELECT
}>

/** A deal won (stage still WON) with the date that counts for the quota. */
export interface CrmDashboardWonDeal {
  ownerId: string | null
  amount: Prisma.Decimal | null
  wonAt: Date
}

const CUSTOMER_HEALTH_SELECT = {
  id: true,
  riskScore: true,
  level: true,
  previousScore: true,
  previousLevel: true,
  nextAction: true,
  computedAt: true,
  company: { select: { name: true, accountOwnerId: true } },
} as const satisfies Prisma.CrmCustomerHealthSelect

export type CrmDashboardCustomerHealth = Prisma.CrmCustomerHealthGetPayload<{
  select: typeof CUSTOMER_HEALTH_SELECT
}>

const OPPORTUNITY_HEALTH_SELECT = {
  id: true,
  riskScore: true,
  level: true,
  previousScore: true,
  previousLevel: true,
  nextAction: true,
  computedAt: true,
  opportunity: {
    select: {
      name: true,
      amount: true,
      ownerId: true,
      company: NAME,
      stage: NAME,
    },
  },
} as const satisfies Prisma.CrmOpportunityHealthSelect

export type CrmDashboardOpportunityHealth =
  Prisma.CrmOpportunityHealthGetPayload<{
    select: typeof OPPORTUNITY_HEALTH_SELECT
  }>

/** Counters of the recipients of a campaign (non-null timestamps). */
export interface CrmDashboardCampaignCounts {
  campaignId: string
  recipients: number
  emailSent: number
  emailDelivered: number
  emailOpened: number
  emailClicked: number
  emailBounced: number
  unsubscribed: number
  whatsappSent: number
  whatsappDelivered: number
  whatsappRead: number
  whatsappClicked: number
  whatsappReplied: number
  converted: number
}

export interface CrmDashboardCampaign {
  id: string
  name: string
  status: string
  whatsappEnabled: boolean
  hasEmail: boolean
  createdAt: Date
  scheduledAt: Date | null
  startedAt: Date | null
  completedAt: Date | null
}

export const CrmDashboardSourceRepository = {
  async proposals(
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<Result<CrmDashboardProposal[]>> {
    try {
      const rows = await prisma.crmProposal.findMany({
        where: { workspaceId, deletedAt: null, createdAt: { gte: since } },
        select: PROPOSAL_SELECT,
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list CRM proposals for dashboards', error))
    }
  },

  /** Contracts that ended inside the window, plus every active one. */
  async contracts(
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<Result<CrmDashboardContract[]>> {
    try {
      const rows = await prisma.crmContract.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          OR: [{ endDate: { gte: since } }, { status: 'ACTIVE' }],
        },
        select: CONTRACT_SELECT,
        orderBy: { endDate: 'desc' },
        take: limit,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list CRM contracts for dashboards', error))
    }
  },

  async charges(
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<Result<CrmDashboardCharge[]>> {
    try {
      const rows = await prisma.crmProposalCharge.findMany({
        where: { workspaceId, createdAt: { gte: since } },
        select: CHARGE_SELECT,
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list CRM charges for dashboards', error))
    }
  },

  async activities(
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<Result<CrmDashboardActivity[]>> {
    try {
      const rows = await prisma.crmActivity.findMany({
        where: { workspaceId, createdAt: { gte: since } },
        select: ACTIVITY_SELECT,
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list CRM activities for dashboards', error))
    }
  },

  async quotas(
    workspaceId: string,
    limit: number,
  ): Promise<Result<CrmDashboardQuota[]>> {
    try {
      const rows = await prisma.crmQuota.findMany({
        where: { workspaceId },
        select: QUOTA_SELECT,
        orderBy: [{ periodKey: 'desc' }, { ownerId: 'asc' }],
        take: limit,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list CRM quotas for dashboards', error))
    }
  },

  /** Deals won in `[from, to)` that still sit in a WON stage. */
  async wonDeals(
    workspaceId: string,
    from: Date,
    to: Date,
    limit: number,
  ): Promise<Result<CrmDashboardWonDeal[]>> {
    try {
      const rows = await prisma.crmOpportunity.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          pipeline: { deletedAt: null },
          wonAt: { gte: from, lt: to },
          stage: { category: 'WON' },
        },
        select: { ownerId: true, amount: true, wonAt: true },
        take: limit,
      })
      return ok(
        rows.filter((row): row is CrmDashboardWonDeal => row.wonAt !== null),
      )
    } catch (error) {
      return err(dbError('Failed to list won deals for dashboards', error))
    }
  },

  async customerHealth(
    workspaceId: string,
    limit: number,
  ): Promise<Result<CrmDashboardCustomerHealth[]>> {
    try {
      const rows = await prisma.crmCustomerHealth.findMany({
        where: { workspaceId, company: { deletedAt: null } },
        select: CUSTOMER_HEALTH_SELECT,
        orderBy: { riskScore: 'desc' },
        take: limit,
      })
      return ok(rows)
    } catch (error) {
      return err(
        dbError('Failed to list customer health for dashboards', error),
      )
    }
  },

  async opportunityHealth(
    workspaceId: string,
    limit: number,
  ): Promise<Result<CrmDashboardOpportunityHealth[]>> {
    try {
      const rows = await prisma.crmOpportunityHealth.findMany({
        where: { workspaceId, opportunity: { deletedAt: null } },
        select: OPPORTUNITY_HEALTH_SELECT,
        orderBy: { riskScore: 'desc' },
        take: limit,
      })
      return ok(rows)
    } catch (error) {
      return err(
        dbError('Failed to list opportunity health for dashboards', error),
      )
    }
  },

  /** Multichannel campaigns and the legacy e-mail ones, newest first. */
  async campaigns(
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<
    Result<{
      multichannel: CrmDashboardCampaign[]
      email: CrmDashboardCampaign[]
    }>
  > {
    try {
      const [multichannel, email] = await Promise.all([
        prisma.crmCampaign.findMany({
          where: { workspaceId, deletedAt: null, createdAt: { gte: since } },
          select: {
            id: true,
            name: true,
            status: true,
            whatsappEnabled: true,
            emailSubject: true,
            createdAt: true,
            scheduledAt: true,
            startAt: true,
            completedAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
        prisma.crmEmailCampaign.findMany({
          where: { workspaceId, createdAt: { gte: since } },
          select: {
            id: true,
            subject: true,
            status: true,
            createdAt: true,
            scheduledAt: true,
            sentAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
      ])
      return ok({
        multichannel: multichannel.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          whatsappEnabled: c.whatsappEnabled,
          hasEmail: Boolean(c.emailSubject),
          createdAt: c.createdAt,
          scheduledAt: c.scheduledAt,
          startedAt: c.startAt,
          completedAt: c.completedAt,
        })),
        email: email.map((c) => ({
          id: c.id,
          name: c.subject,
          status: c.status,
          whatsappEnabled: false,
          hasEmail: true,
          createdAt: c.createdAt,
          scheduledAt: c.scheduledAt,
          startedAt: c.sentAt,
          completedAt: c.sentAt,
        })),
      })
    } catch (error) {
      return err(dbError('Failed to list CRM campaigns for dashboards', error))
    }
  },

  /** Recipient counters of multichannel campaigns, one group per campaign. */
  async campaignCounts(
    campaignIds: string[],
  ): Promise<Result<CrmDashboardCampaignCounts[]>> {
    if (campaignIds.length === 0) return ok([])
    try {
      const groups = await prisma.crmCampaignRecipient.groupBy({
        by: ['campaignId'],
        where: { campaignId: { in: campaignIds } },
        _count: {
          _all: true,
          emailSentAt: true,
          emailDeliveredAt: true,
          emailOpenedAt: true,
          emailClickedAt: true,
          emailBouncedAt: true,
          unsubscribedAt: true,
          whatsappSentAt: true,
          whatsappDeliveredAt: true,
          whatsappReadAt: true,
          whatsappClickedAt: true,
          whatsappRepliedAt: true,
          convertedAt: true,
        },
      })
      return ok(
        groups.map((g) => ({
          campaignId: g.campaignId,
          recipients: g._count._all,
          emailSent: g._count.emailSentAt,
          emailDelivered: g._count.emailDeliveredAt,
          emailOpened: g._count.emailOpenedAt,
          emailClicked: g._count.emailClickedAt,
          emailBounced: g._count.emailBouncedAt,
          unsubscribed: g._count.unsubscribedAt,
          whatsappSent: g._count.whatsappSentAt,
          whatsappDelivered: g._count.whatsappDeliveredAt,
          whatsappRead: g._count.whatsappReadAt,
          whatsappClicked: g._count.whatsappClickedAt,
          whatsappReplied: g._count.whatsappRepliedAt,
          converted: g._count.convertedAt,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to count campaign recipients', error))
    }
  },

  /** Recipient counters of legacy e-mail campaigns (by delivery status). */
  async emailCampaignCounts(
    campaignIds: string[],
  ): Promise<
    Result<{ campaignId: string; recipients: number; sent: number }[]>
  > {
    if (campaignIds.length === 0) return ok([])
    try {
      const groups = await prisma.crmEmailCampaignRecipient.groupBy({
        by: ['campaignId', 'status'],
        where: { campaignId: { in: campaignIds } },
        _count: { _all: true },
      })
      const byCampaign = new Map<
        string,
        { campaignId: string; recipients: number; sent: number }
      >()
      for (const g of groups) {
        const entry = byCampaign.get(g.campaignId) ?? {
          campaignId: g.campaignId,
          recipients: 0,
          sent: 0,
        }
        entry.recipients += g._count._all
        if (g.status === 'SENT') entry.sent += g._count._all
        byCampaign.set(g.campaignId, entry)
      }
      return ok([...byCampaign.values()])
    } catch (error) {
      return err(dbError('Failed to count e-mail campaign recipients', error))
    }
  },

  /** Workspace members (id → name) to resolve owners without a relation. */
  async memberNames(workspaceId: string): Promise<Result<Map<string, string>>> {
    try {
      const rows = await prisma.membership.findMany({
        where: { workspaceId },
        select: { user: { select: { id: true, name: true } } },
      })
      return ok(new Map(rows.map((row) => [row.user.id, row.user.name])))
    } catch (error) {
      return err(dbError('Failed to list workspace members', error))
    }
  },
}
