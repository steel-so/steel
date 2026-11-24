import { logger } from '@/lib/axiom/logger'
import { ok, type Result } from '@/src/lib/result'
import {
  toCrmActivityDashboardRow,
  toCrmCampaignDashboardRow,
  toCrmChargeDashboardRow,
  toCrmContractDashboardRow,
  toCrmCustomerHealthDashboardRow,
  toCrmEmailCampaignDashboardRow,
  toCrmOpportunityHealthDashboardRow,
  toCrmProposalDashboardRow,
  toCrmQuotaDashboardRows,
  wonByQuotaPeriod,
} from '@/src/mappers/crm-dashboard-source.mapper'
import { CrmDashboardSourceRepository as Repo } from '@/src/repositories/crm-dashboard-source.repository'
import {
  CRM_DASHBOARD_HISTORY_DAYS,
  CRM_DASHBOARD_ROW_LIMITS,
  type CrmDashboardSource,
} from '@/src/schemas/crm-dashboard-source.schema'
import type { CrmDashboardRow } from '@/types/crm-dashboard-source'
import { assertModuleMember } from './authz'

const DAY_MS = 86_400_000

type Loader = (
  workspaceId: string,
  since: Date,
  limit: number,
  now: Date,
) => Promise<Result<CrmDashboardRow[]>>

/** One loader per source: a new source only adds its entry here. */
const LOADERS: Record<CrmDashboardSource, Loader> = {
  'crm-proposals': async (workspaceId, since, limit, now) => {
    const data = await Repo.proposals(workspaceId, since, limit)
    if (!data.ok) return data
    return ok(data.value.map((p) => toCrmProposalDashboardRow(p, now)))
  },
  'crm-contracts': async (workspaceId, since, limit, now) => {
    const [data, members] = await Promise.all([
      Repo.contracts(workspaceId, since, limit),
      Repo.memberNames(workspaceId),
    ])
    if (!data.ok) return data
    if (!members.ok) return members
    return ok(
      data.value.map((c) => toCrmContractDashboardRow(c, members.value, now)),
    )
  },
  'crm-charges': async (workspaceId, since, limit) => {
    const [data, members] = await Promise.all([
      Repo.charges(workspaceId, since, limit),
      Repo.memberNames(workspaceId),
    ])
    if (!data.ok) return data
    if (!members.ok) return members
    return ok(data.value.map((c) => toCrmChargeDashboardRow(c, members.value)))
  },
  'crm-activities': async (workspaceId, since, limit) => {
    const data = await Repo.activities(workspaceId, since, limit)
    if (!data.ok) return data
    return ok(data.value.map(toCrmActivityDashboardRow))
  },
  // Current state: the history window does not apply.
  'crm-quotas': async (workspaceId, _since, limit, now) => {
    const quotas = await Repo.quotas(workspaceId, limit)
    if (!quotas.ok) return quotas
    if (quotas.value.length === 0) return ok([])
    // Won deals since the earliest period key (`2026-10` / `2026-Q4`).
    const earliest = quotas.value.reduce<Date>((min, q) => {
      const year = Number(q.periodKey.slice(0, 4))
      const month =
        q.period === 'QUARTER'
          ? (Number(q.periodKey.slice(6)) - 1) * 3
          : Number(q.periodKey.slice(5)) - 1
      const start = new Date(Date.UTC(year, month, 1))
      return Number.isNaN(start.getTime()) || start >= min ? min : start
    }, now)
    const deals = await Repo.wonDeals(
      workspaceId,
      earliest,
      new Date(now.getTime() + DAY_MS),
      20_000,
    )
    if (!deals.ok) return deals
    return ok(
      toCrmQuotaDashboardRows(quotas.value, wonByQuotaPeriod(deals.value), now),
    )
  },
  'crm-health': async (workspaceId, _since, limit) => {
    const [customers, deals, members] = await Promise.all([
      Repo.customerHealth(workspaceId, limit),
      Repo.opportunityHealth(workspaceId, limit),
      Repo.memberNames(workspaceId),
    ])
    if (!customers.ok) return customers
    if (!deals.ok) return deals
    if (!members.ok) return members
    return ok([
      ...customers.value.map((h) =>
        toCrmCustomerHealthDashboardRow(h, members.value),
      ),
      ...deals.value.map((h) =>
        toCrmOpportunityHealthDashboardRow(h, members.value),
      ),
    ])
  },
  'crm-campaigns': async (workspaceId, since, limit) => {
    const campaigns = await Repo.campaigns(workspaceId, since, limit)
    if (!campaigns.ok) return campaigns
    const { multichannel, email } = campaigns.value
    const [counts, emailCounts] = await Promise.all([
      Repo.campaignCounts(multichannel.map((c) => c.id)),
      Repo.emailCampaignCounts(email.map((c) => c.id)),
    ])
    if (!counts.ok) return counts
    if (!emailCounts.ok) return emailCounts
    const byId = new Map(counts.value.map((c) => [c.campaignId, c]))
    const emailById = new Map(emailCounts.value.map((c) => [c.campaignId, c]))
    return ok([
      ...multichannel.map((c) => toCrmCampaignDashboardRow(c, byId.get(c.id))),
      ...email.map((c) =>
        toCrmEmailCampaignDashboardRow(c, emailById.get(c.id)),
      ),
    ])
  },
}

/**
 * Data of the CRM dashboard sources that serve flattened rows. Same gate as
 * the dashboards themselves (CRM module enabled + `dashboards:VIEW`), always
 * scoped to the caller's workspace. The cut is the history of
 * `CRM_DASHBOARD_HISTORY_DAYS` days with a row ceiling per source. These
 * sources are not served on TV links.
 */
export const CrmDashboardSourceService = {
  async rows(
    actorId: string,
    workspaceId: string,
    source: CrmDashboardSource,
    now: Date = new Date(),
  ): Promise<Result<CrmDashboardRow[]>> {
    const access = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'dashboards',
      action: 'VIEW',
    })
    if (!access.ok) return access

    const limit = CRM_DASHBOARD_ROW_LIMITS[source]
    const since = new Date(now.getTime() - CRM_DASHBOARD_HISTORY_DAYS * DAY_MS)
    const rows = await LOADERS[source](workspaceId, since, limit, now)
    if (!rows.ok) return rows
    if (rows.value.length >= limit) {
      logger.warn('crm.dashboard.source_truncated', {
        workspaceId,
        source,
        limit,
      })
    }
    return rows
  },
}
