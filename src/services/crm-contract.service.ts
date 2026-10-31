import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { badRequest, crmContractInvalid } from '@/src/errors'
import {
  computePeerAdoption,
  daysUntil,
  rankUpsell,
  renewalAlertBody,
  renewalDealName,
  renewalWindowEnd,
  upsellTiming,
} from '@/src/lib/crm-deals'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toCrmContractDTO,
} from '@/src/mappers/crm-deals.mapper'
import {
  CrmContractRepository,
  type CrmContractWithCompany,
} from '@/src/repositories/crm-contract.repository'
import { CrmCompanyRepository } from '@/src/repositories/crm-company.repository'
import { CrmHealthRepository } from '@/src/repositories/crm-health.repository'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import {
  CrmPipelineRepository,
  CrmPipelineStageRepository,
} from '@/src/repositories/crm-pipeline.repository'
import type {
  CreateCrmContractDTO,
  ListCrmContractsQuery,
  UpdateCrmContractDTO,
} from '@/src/schemas/crm-deals.schema'
import type {
  CrmContractDTO,
  CrmDealsSettingsDTO,
  CrmRenewalScanResultDTO,
  CrmUpsellDTO,
} from '@/types/crm-deals'
import {
  assertMember,
  assertModuleMember,
  assertModulePrivileged,
} from './authz'
import { notifyCrmContractExpiring } from './crm-notifications'
import { CrmDealsSettingsService } from './crm-deals-settings.service'

const MAX_ROLL_TERMS = 24
const UPSELL_LIMIT = 5

/**
 * Opens the renewal deal of a contract: same pipeline as the deal that sold
 * it (or the default one), first open stage, value and close date from the
 * contract, owned by the contract owner or the account owner.
 */
async function createRenewalDeal(
  contract: CrmContractWithCompany,
  actorId: string | null,
  now: Date,
): Promise<Result<string>> {
  const { workspaceId } = contract
  let pipelineId: string | null = null
  if (contract.opportunityId) {
    const origin = await CrmOpportunityRepository.findById(
      contract.opportunityId,
      workspaceId,
    )
    if (origin.ok) pipelineId = origin.value.pipelineId
  }
  if (!pipelineId) {
    const fallback = await CrmPipelineRepository.findDefault(workspaceId)
    if (!fallback.ok) return fallback
    pipelineId = fallback.value?.id ?? null
    if (!pipelineId) {
      // No default pipeline marked: the first one of the workspace will do.
      const all = await CrmPipelineRepository.listByWorkspace(workspaceId)
      if (!all.ok) return all
      pipelineId = all.value[0]?.id ?? null
    }
  }
  if (!pipelineId) {
    return err(crmContractInvalid('Crie um pipeline antes de renovar contratos'))
  }

  const stages = await CrmPipelineStageRepository.listByPipeline(pipelineId)
  if (!stages.ok) return stages
  const stage = stages.value.find((candidate) => candidate.category === 'OPEN')
  if (!stage) {
    return err(crmContractInvalid('O pipeline não tem uma etapa em aberto'))
  }

  const deal = await CrmOpportunityRepository.create({
    workspaceId,
    createdById: actorId ?? contract.createdById,
    name: renewalDealName(contract.name),
    amount: contract.value === null ? undefined : Number(contract.value),
    closeDate: contract.endDate,
    pipelineId,
    stageId: stage.id,
    companyId: contract.companyId,
    ownerId: contract.ownerId ?? contract.company.accountOwnerId ?? undefined,
    source: 'Renovação',
  })
  if (!deal.ok) return deal

  const linked = await CrmContractRepository.update(contract.id, {
    renewalOpportunityId: deal.value.id,
    renewalCreatedAt: now,
  })
  if (!linked.ok) return linked
  return ok(deal.value.id)
}

/** Rolls an auto-renewing contract forward, one term at a time, past `now`. */
function nextTerm(
  startDate: Date,
  endDate: Date,
  now: Date,
): { startDate: Date; endDate: Date } {
  const term = Math.max(endDate.getTime() - startDate.getTime(), 86_400_000)
  let start = endDate
  let end = new Date(endDate.getTime() + term)
  for (let i = 0; i < MAX_ROLL_TERMS && end.getTime() < now.getTime(); i++) {
    start = end
    end = new Date(end.getTime() + term)
  }
  return { startDate: start, endDate: end }
}

async function tickWorkspace(
  workspaceId: string,
  settings: CrmDealsSettingsDTO,
  now: Date,
  result: CrmRenewalScanResultDTO,
): Promise<void> {
  const windowEnd = renewalWindowEnd(settings.renewalLeadDays, now)

  const toAlert = await CrmContractRepository.listToAlert(workspaceId, windowEnd)
  if (toAlert.ok) {
    for (const contract of toAlert.value) {
      await notifyCrmContractExpiring({
        workspaceId,
        contractId: contract.id,
        recipientId: contract.ownerId ?? contract.company.accountOwnerId,
        companyId: contract.companyId,
        body: renewalAlertBody(
          contract.name,
          contract.company.name,
          daysUntil(contract.endDate, now),
        ),
      })
      const marked = await CrmContractRepository.update(contract.id, {
        alertedAt: now,
      })
      if (marked.ok) result.alerted++
      else result.errors++
    }
  } else {
    result.errors++
  }

  if (settings.renewalAutoCreate) {
    const toRenew = await CrmContractRepository.listToRenew(
      workspaceId,
      windowEnd,
    )
    if (toRenew.ok) {
      for (const contract of toRenew.value) {
        const created = await createRenewalDeal(contract, null, now)
        if (created.ok) result.renewalsCreated++
        else {
          result.errors++
          logger.warn('crm.contracts.renewal_failed', {
            workspaceId,
            contractId: contract.id,
            code: created.error.code,
          })
        }
      }
    } else {
      result.errors++
    }
  }

  const due = await CrmContractRepository.listAutoRenewDue(workspaceId, now)
  if (due.ok) {
    for (const contract of due.value) {
      const term = nextTerm(contract.startDate, contract.endDate, now)
      const rolled = await CrmContractRepository.update(contract.id, {
        ...term,
        alertedAt: null,
        renewalOpportunityId: null,
        renewalCreatedAt: null,
      })
      if (rolled.ok) result.rolled++
      else result.errors++
    }
  } else {
    result.errors++
  }

  const expired = await CrmContractRepository.expireEnded(workspaceId, now)
  if (expired.ok) result.expired += expired.value
  else result.errors++
}

/**
 * C9: post-sale. Tracks customer contracts, warns the owner when one enters
 * the renewal window, opens the renewal deal on its own and suggests what to
 * sell next using the satisfaction survey (T1) and the health score (T4).
 */
export const CrmContractService = {
  async list(
    actorId: string,
    workspaceId: string,
    query: ListCrmContractsQuery,
  ): Promise<Result<CrmContractDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'companies',
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const settings = await CrmDealsSettingsService.resolve(workspaceId)
    if (!settings.ok) return settings

    const now = new Date()
    const rows = await CrmContractRepository.list(workspaceId, {
      status: query.status ?? (query.endsWithinDays ? 'ACTIVE' : undefined),
      companyId: query.companyId,
      endsBefore: query.endsWithinDays
        ? renewalWindowEnd(query.endsWithinDays, now)
        : undefined,
    })
    if (!rows.ok) return rows
    return ok(
      rows.value.map((row) =>
        toCrmContractDTO(row, settings.value.renewalLeadDays, now),
      ),
    )
  },

  async get(
    actorId: string,
    workspaceId: string,
    contractId: string,
  ): Promise<Result<CrmContractDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'companies',
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const settings = await CrmDealsSettingsService.resolve(workspaceId)
    if (!settings.ok) return settings
    const row = await CrmContractRepository.findById(contractId, workspaceId)
    if (!row.ok) return row
    return ok(toCrmContractDTO(row.value, settings.value.renewalLeadDays))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmContractDTO,
  ): Promise<Result<CrmContractDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'companies',
      action: 'CREATE',
    })
    if (!membership.ok) return membership
    const settings = await CrmDealsSettingsService.resolve(workspaceId)
    if (!settings.ok) return settings

    const company = await CrmCompanyRepository.findById(
      dto.companyId,
      workspaceId,
    )
    if (!company.ok) return company
    if (dto.opportunityId) {
      const deal = await CrmOpportunityRepository.findById(
        dto.opportunityId,
        workspaceId,
      )
      if (!deal.ok) return deal
    }
    if (dto.ownerId) {
      const owner = await assertMember(dto.ownerId, workspaceId)
      if (!owner.ok) return owner
    }

    const created = await CrmContractRepository.create({
      workspaceId,
      companyId: dto.companyId,
      opportunityId: dto.opportunityId ?? null,
      ownerId: dto.ownerId ?? company.value.accountOwnerId,
      createdById: actorId,
      name: dto.name,
      value: dto.value ?? null,
      startDate: dto.startDate,
      endDate: dto.endDate,
      autoRenews: dto.autoRenews,
      notes: dto.notes ?? null,
    })
    if (!created.ok) return created

    auditMutation({
      entity: 'crm_contract',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, companyId: dto.companyId },
    })
    return ok(toCrmContractDTO(created.value, settings.value.renewalLeadDays))
  },

  async update(
    actorId: string,
    workspaceId: string,
    contractId: string,
    dto: UpdateCrmContractDTO,
  ): Promise<Result<CrmContractDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'companies',
      action: 'EDIT',
    })
    if (!membership.ok) return membership
    const settings = await CrmDealsSettingsService.resolve(workspaceId)
    if (!settings.ok) return settings
    const existing = await CrmContractRepository.findById(
      contractId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const startDate = dto.startDate ?? existing.value.startDate
    const endDate = dto.endDate ?? existing.value.endDate
    if (endDate <= startDate) {
      return err(badRequest('O fim do contrato deve ser depois do início'))
    }
    if (dto.ownerId) {
      const owner = await assertMember(dto.ownerId, workspaceId)
      if (!owner.ok) return owner
    }

    const endChanged =
      dto.endDate !== undefined &&
      dto.endDate.getTime() !== existing.value.endDate.getTime()
    const updated = await CrmContractRepository.update(contractId, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.ownerId !== undefined && { ownerId: dto.ownerId }),
      ...(dto.value !== undefined && { value: dto.value }),
      ...(dto.startDate !== undefined && { startDate: dto.startDate }),
      ...(dto.endDate !== undefined && { endDate: dto.endDate }),
      ...(dto.autoRenews !== undefined && { autoRenews: dto.autoRenews }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
      // A new end date opens a new renewal window.
      ...(endChanged && { alertedAt: null }),
    })
    if (!updated.ok) return updated

    auditMutation({
      entity: 'crm_contract',
      action: 'update',
      actorId,
      targetId: contractId,
      meta: { workspaceId, fields: Object.keys(dto) },
    })
    return ok(toCrmContractDTO(updated.value, settings.value.renewalLeadDays))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    contractId: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'companies',
      action: 'DELETE',
    })
    if (!membership.ok) return membership
    const existing = await CrmContractRepository.findById(
      contractId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const removed = await CrmContractRepository.softDelete(contractId)
    if (!removed.ok) return removed
    auditMutation({
      entity: 'crm_contract',
      action: 'delete',
      actorId,
      targetId: contractId,
      meta: { workspaceId },
    })
    return ok(undefined)
  },

  /** Opens the renewal deal now, without waiting for the window. */
  async renew(
    actorId: string,
    workspaceId: string,
    contractId: string,
  ): Promise<Result<CrmContractDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'CREATE',
    })
    if (!membership.ok) return membership
    const settings = await CrmDealsSettingsService.resolve(workspaceId)
    if (!settings.ok) return settings
    const existing = await CrmContractRepository.findById(
      contractId,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (existing.value.status !== 'ACTIVE') {
      return err(crmContractInvalid('Só um contrato ativo pode ser renovado'))
    }
    if (existing.value.renewalOpportunityId) {
      return err(
        crmContractInvalid('Este contrato já tem uma oportunidade de renovação'),
      )
    }

    const created = await createRenewalDeal(existing.value, actorId, new Date())
    if (!created.ok) return created

    auditMutation({
      entity: 'crm_contract',
      action: 'create',
      actorId,
      targetId: contractId,
      meta: { workspaceId, renewalOpportunityId: created.value },
    })
    const fresh = await CrmContractRepository.findById(contractId, workspaceId)
    if (!fresh.ok) return fresh
    return ok(toCrmContractDTO(fresh.value, settings.value.renewalLeadDays))
  },

  /** Expansion ideas for a customer, with the survey and health that frame them. */
  async upsell(
    actorId: string,
    workspaceId: string,
    companyId: string,
  ): Promise<Result<CrmUpsellDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'companies',
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const company = await CrmCompanyRepository.findById(companyId, workspaceId)
    if (!company.ok) return company

    const [rows, satisfaction, health] = await Promise.all([
      CrmContractRepository.wonProductRows(workspaceId),
      CrmContractRepository.latestSatisfaction(workspaceId, companyId),
      CrmContractRepository.customerHealthLevel(workspaceId, companyId),
    ])
    if (!rows.ok) return rows
    if (!satisfaction.ok) return satisfaction
    if (!health.ok) return health

    const owned = new Set(
      rows.value
        .filter((row) => row.companyId === companyId)
        .map((row) => row.productId),
    )
    const peers = rows.value.filter((row) => row.companyId !== companyId)
    const suggestions = rankUpsell(
      computePeerAdoption(peers, owned),
      UPSELL_LIMIT,
    )
    const timing = upsellTiming(satisfaction.value, health.value)

    return ok({
      companyId,
      timing: timing.timing,
      timingReason: timing.reason,
      satisfaction: satisfaction.value
        ? {
            kind: satisfaction.value.kind,
            score: satisfaction.value.score,
            answeredAt: satisfaction.value.answeredAt.toISOString(),
          }
        : null,
      healthLevel: health.value,
      suggestions,
    })
  },

  /** OWNER/ADMIN: runs the renewal scan of the workspace now. */
  async scan(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmRenewalScanResultDTO>> {
    const privileged = await assertModulePrivileged(actorId, workspaceId, 'CRM')
    if (!privileged.ok) return privileged
    return CrmContractService.renewalTick({ workspaceId })
  },

  /** Daily job: every CRM workspace, or just `workspaceId`. */
  async renewalTick(
    input: { workspaceId?: string } = {},
    now: Date = new Date(),
  ): Promise<Result<CrmRenewalScanResultDTO>> {
    const result: CrmRenewalScanResultDTO = {
      workspaces: 0,
      expired: 0,
      rolled: 0,
      alerted: 0,
      renewalsCreated: 0,
      errors: 0,
    }
    const workspaces = input.workspaceId
      ? ok([input.workspaceId])
      : await CrmHealthRepository.listCrmWorkspaceIds()
    if (!workspaces.ok) return workspaces

    for (const workspaceId of workspaces.value) {
      result.workspaces++
      try {
        const settings = await CrmDealsSettingsService.resolve(workspaceId)
        if (!settings.ok) {
          result.errors++
          continue
        }
        await tickWorkspace(workspaceId, settings.value, now, result)
      } catch (error) {
        result.errors++
        logger.error('crm.contracts.workspace_failed', {
          workspaceId,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return ok(result)
  },
}
