import type { CrmCustomerHealth, CrmOpportunityHealth } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  crmCompanyNotFound,
  crmHealthNotApplicable,
  crmOpportunityNotFound,
} from '@/src/errors'
import {
  computeCustomerHealth,
  computeOpportunityHealth,
  HEALTH_LEVEL_LABEL,
  type HealthComputation,
  shouldAlertHealth,
} from '@/src/lib/crm-health'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toCrmCustomerHealthDTO,
  toCrmOpportunityHealthDTO,
} from '@/src/mappers/crm-health.mapper'
import { CrmHealthRepository } from '@/src/repositories/crm-health.repository'
import { CrmHealthSignalsRepository } from '@/src/repositories/crm-health-signals.repository'
import type {
  ListCrmCustomerHealthQuery,
  ListCrmOpportunityHealthQuery,
} from '@/src/schemas/crm-health.schema'
import type {
  CrmCustomerHealthDTO,
  CrmOpportunityHealthDTO,
} from '@/types/crm-health'
import { assertModuleMember } from './authz'
import {
  notifyCrmCustomerHealthDrop,
  notifyCrmOpportunityAtRisk,
} from './crm-notifications'

/**
 * Health scores of the CRM: T4 (churn risk of a company) and C4 (risk of an
 * open deal). The score is an explainable heuristic computed by the pure lib
 * `src/lib/crm-health` (the same design as the ServiceDesk risk, ADR 0016);
 * this service collects the signals, stores one row per record and warns the
 * owner when a record **enters** the high band (or jumps) - never every tick.
 *
 * The worker recomputes hourly (`crm-health`); the panels also ask for a
 * recompute on demand. Deals are scored before companies so the customer
 * score sees fresh deal risk.
 */

/** Per workspace and tick; the stalest scores go first, the rest wait. */
export const HEALTH_TICK_COMPANY_LIMIT = 300
export const HEALTH_TICK_OPPORTUNITY_LIMIT = 500
/** Jump (points) since the previous computation that raises an alert. */
export const HEALTH_ALERT_JUMP = 20

export interface CrmHealthTickResult {
  workspaces: number
  opportunities: number
  companies: number
  notified: number
  removed: number
  errors: number
}

interface Computed<Row> {
  row: Row
  computation: HealthComputation
}

async function scoreCompany(
  workspaceId: string,
  companyId: string,
  now: Date,
  alert: boolean,
): Promise<
  Result<Computed<CrmCustomerHealth> & { notified: number; name: string }>
> {
  const company = await CrmHealthRepository.findCompany(workspaceId, companyId)
  if (!company.ok) return company
  if (!company.value) return err(crmCompanyNotFound())

  const signals = await CrmHealthSignalsRepository.customerSignals(
    workspaceId,
    company.value,
    now,
  )
  if (!signals.ok) return signals

  const computation = computeCustomerHealth(signals.value)
  const saved = await CrmHealthRepository.upsertCustomerHealth(
    workspaceId,
    companyId,
    computation,
    signals.value,
    now,
  )
  if (!saved.ok) return saved

  let notified = 0
  if (
    alert &&
    shouldAlertHealth({
      level: computation.level,
      riskScore: computation.riskScore,
      previousLevel: saved.value.previousLevel,
      previousScore: saved.value.previousScore,
      jump: HEALTH_ALERT_JUMP,
    })
  ) {
    notified = await notifyCrmCustomerHealthDrop({
      workspaceId,
      recipientId: company.value.accountOwnerId,
      company: { id: companyId, name: company.value.name },
      riskScore: computation.riskScore,
      levelLabel: levelLabel(computation),
      reason: computation.factors[0]?.detail ?? null,
      nextAction: computation.nextAction.label,
      computedAt: now,
    })
  }
  return ok({
    row: saved.value.row,
    computation,
    notified,
    name: company.value.name,
  })
}

async function scoreOpportunity(
  workspaceId: string,
  opportunityId: string,
  now: Date,
  alert: boolean,
): Promise<
  Result<
    | (Computed<CrmOpportunityHealth> & { notified: number; name: string })
    | { closed: true }
  >
> {
  const deal = await CrmHealthRepository.findOpportunity(
    workspaceId,
    opportunityId,
  )
  if (!deal.ok) return deal
  if (!deal.value) return err(crmOpportunityNotFound())
  if (!deal.value.isOpen) {
    const dropped =
      await CrmHealthRepository.deleteOpportunityHealth(opportunityId)
    if (!dropped.ok) return dropped
    return ok({ closed: true as const })
  }

  const signals = await CrmHealthSignalsRepository.opportunitySignals(
    workspaceId,
    deal.value,
    now,
  )
  if (!signals.ok) return signals

  const computation = computeOpportunityHealth(signals.value)
  const saved = await CrmHealthRepository.upsertOpportunityHealth(
    workspaceId,
    opportunityId,
    computation,
    signals.value,
    now,
  )
  if (!saved.ok) return saved

  let notified = 0
  // A deal only matters when it enters the high band; a jump alone is noise.
  if (
    alert &&
    computation.level === 'HIGH' &&
    saved.value.previousLevel !== 'HIGH'
  ) {
    notified = await notifyCrmOpportunityAtRisk({
      workspaceId,
      recipientId: deal.value.ownerId,
      opportunity: { id: opportunityId, name: deal.value.name },
      riskScore: computation.riskScore,
      levelLabel: levelLabel(computation),
      reason: computation.factors[0]?.detail ?? null,
      nextAction: computation.nextAction.label,
      computedAt: now,
    })
  }
  return ok({
    row: saved.value.row,
    computation,
    notified,
    name: deal.value.name,
  })
}

const levelLabel = (computation: HealthComputation): string =>
  HEALTH_LEVEL_LABEL[computation.level]

async function computeCustomer(
  workspaceId: string,
  companyId: string,
  now: Date,
  alert: boolean,
): Promise<Result<CrmCustomerHealthDTO>> {
  const scored = await scoreCompany(workspaceId, companyId, now, alert)
  if (!scored.ok) return scored
  return ok(
    toCrmCustomerHealthDTO({
      ...scored.value.row,
      company: { name: scored.value.name, accountOwnerId: null },
    }),
  )
}

async function computeOpportunityDto(
  workspaceId: string,
  opportunityId: string,
  now: Date,
  alert: boolean,
): Promise<Result<CrmOpportunityHealthDTO>> {
  const scored = await scoreOpportunity(workspaceId, opportunityId, now, alert)
  if (!scored.ok) return scored
  if ('closed' in scored.value) return err(crmHealthNotApplicable())
  return ok(
    toCrmOpportunityHealthDTO({
      ...scored.value.row,
      opportunity: { name: scored.value.name, ownerId: null },
    }),
  )
}

export const CrmHealthService = {
  // ─── customers (T4) ───────────────────────────────────────────────────────

  /** Stored score of a company; computes it on the spot the first time. */
  async getCustomerHealth(
    actorId: string,
    workspaceId: string,
    companyId: string,
    now: Date = new Date(),
  ): Promise<Result<CrmCustomerHealthDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'companies',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const company = await CrmHealthRepository.findCompany(
      workspaceId,
      companyId,
    )
    if (!company.ok) return company
    if (!company.value) return err(crmCompanyNotFound())

    const stored = await CrmHealthRepository.getCustomerHealth(
      workspaceId,
      companyId,
    )
    if (!stored.ok) return stored
    if (stored.value) {
      return ok(
        toCrmCustomerHealthDTO({
          ...stored.value,
          company: {
            name: company.value.name,
            accountOwnerId: company.value.accountOwnerId,
          },
        }),
      )
    }
    // First look: no alert, so opening a panel never notifies anyone.
    return computeCustomer(workspaceId, companyId, now, false)
  },

  async listCustomerHealth(
    actorId: string,
    workspaceId: string,
    query: ListCrmCustomerHealthQuery,
  ): Promise<Result<CrmCustomerHealthDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'companies',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const rows = await CrmHealthRepository.listCustomerHealth(
      workspaceId,
      query,
    )
    if (!rows.ok) return rows
    return ok(rows.value.map(toCrmCustomerHealthDTO))
  },

  async recomputeCustomerHealth(
    actorId: string,
    workspaceId: string,
    companyId: string,
    now: Date = new Date(),
  ): Promise<Result<CrmCustomerHealthDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'companies',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const result = await computeCustomer(workspaceId, companyId, now, true)
    if (!result.ok) return result
    auditMutation({
      entity: 'crm_customer_health',
      action: 'update',
      actorId,
      targetId: companyId,
      meta: { riskScore: result.value.riskScore, level: result.value.level },
    })
    return result
  },

  // ─── opportunities (C4) ───────────────────────────────────────────────────

  /** Stored score of an open deal; computes it the first time. */
  async getOpportunityHealth(
    actorId: string,
    workspaceId: string,
    opportunityId: string,
    now: Date = new Date(),
  ): Promise<Result<CrmOpportunityHealthDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const deal = await CrmHealthRepository.findOpportunity(
      workspaceId,
      opportunityId,
    )
    if (!deal.ok) return deal
    if (!deal.value) return err(crmOpportunityNotFound())
    if (!deal.value.isOpen) return err(crmHealthNotApplicable())

    const stored = await CrmHealthRepository.getOpportunityHealth(
      workspaceId,
      opportunityId,
    )
    if (!stored.ok) return stored
    if (stored.value) {
      return ok(
        toCrmOpportunityHealthDTO({
          ...stored.value,
          opportunity: { name: deal.value.name, ownerId: deal.value.ownerId },
        }),
      )
    }
    return computeOpportunityDto(workspaceId, opportunityId, now, false)
  },

  async listOpportunityHealth(
    actorId: string,
    workspaceId: string,
    query: ListCrmOpportunityHealthQuery,
  ): Promise<Result<CrmOpportunityHealthDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const rows = await CrmHealthRepository.listOpportunityHealth(
      workspaceId,
      query,
    )
    if (!rows.ok) return rows
    return ok(rows.value.map(toCrmOpportunityHealthDTO))
  },

  async recomputeOpportunityHealth(
    actorId: string,
    workspaceId: string,
    opportunityId: string,
    now: Date = new Date(),
  ): Promise<Result<CrmOpportunityHealthDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const result = await computeOpportunityDto(
      workspaceId,
      opportunityId,
      now,
      true,
    )
    if (!result.ok) return result
    auditMutation({
      entity: 'crm_opportunity_health',
      action: 'update',
      actorId,
      targetId: opportunityId,
      meta: { riskScore: result.value.riskScore, level: result.value.level },
    })
    return result
  },

  // ─── worker ───────────────────────────────────────────────────────────────

  /**
   * Hourly tick: per CRM workspace, drops the rows of closed deals, scores the
   * open deals and then the companies (stalest first, capped). A failing
   * record is logged and counted, never aborts the run.
   */
  async recomputeTick(
    input: { workspaceId?: string } = {},
    now: Date = new Date(),
  ): Promise<Result<CrmHealthTickResult>> {
    const result: CrmHealthTickResult = {
      workspaces: 0,
      opportunities: 0,
      companies: 0,
      notified: 0,
      removed: 0,
      errors: 0,
    }
    const workspaces = input.workspaceId
      ? ok([input.workspaceId])
      : await CrmHealthRepository.listCrmWorkspaceIds()
    if (!workspaces.ok) return workspaces

    for (const workspaceId of workspaces.value) {
      result.workspaces++
      try {
        await tickWorkspace(workspaceId, now, result)
      } catch (error) {
        result.errors++
        logger.error('crm.health.workspace_failed', {
          workspaceId,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return ok(result)
  },
}

async function tickWorkspace(
  workspaceId: string,
  now: Date,
  result: CrmHealthTickResult,
): Promise<void> {
  const removed =
    await CrmHealthRepository.deleteClosedOpportunityHealth(workspaceId)
  if (removed.ok) result.removed += removed.value
  else result.errors++

  const deals = await CrmHealthRepository.listOpportunitiesToCompute(
    workspaceId,
    HEALTH_TICK_OPPORTUNITY_LIMIT,
  )
  if (!deals.ok) {
    result.errors++
  } else {
    for (const id of deals.value) {
      const scored = await scoreOpportunity(workspaceId, id, now, true)
      if (!scored.ok) {
        result.errors++
        continue
      }
      if ('closed' in scored.value) continue
      result.opportunities++
      result.notified += scored.value.notified
    }
  }

  const companies = await CrmHealthRepository.listCompaniesToCompute(
    workspaceId,
    HEALTH_TICK_COMPANY_LIMIT,
  )
  if (!companies.ok) {
    result.errors++
    return
  }
  for (const id of companies.value) {
    const scored = await scoreCompany(workspaceId, id, now, true)
    if (!scored.ok) {
      result.errors++
      continue
    }
    result.companies++
    result.notified += scored.value.notified
  }
}
