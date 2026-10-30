import type { CrmCompany, Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { crmCnpjInvalid, crmCnpjRunActive } from '@/src/errors'
import { getCnpjProvider } from '@/src/lib/cnpj/provider'
import { isValidCnpj, normalizeCnpj } from '@/src/lib/crm-cnpj'
import { CrmCnpjEnrichmentJob } from '@/src/lib/queue/jobs'
import { getCrmCnpjEnrichmentQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import {
  toCrmCnpjProfileDTO,
  toCrmCnpjRunDTO,
  toCrmCompanyEnrichmentDTO,
  toEnrichmentData,
} from '@/src/mappers/crm-cnpj.mapper'
import { toCrmCompanyDTO } from '@/src/mappers/crm-company.mapper'
import { CrmCnpjRunRepository } from '@/src/repositories/crm-cnpj-run.repository'
import { CrmCompanyRepository } from '@/src/repositories/crm-company.repository'
import { CrmCompanyEnrichmentRepository } from '@/src/repositories/crm-company-enrichment.repository'
import type {
  EnrichCompanyDTO,
  ListCnpjRunsDTO,
  LookupCnpjDTO,
  StartCnpjRunDTO,
} from '@/src/schemas/crm-cnpj.schema'
import type {
  CrmCnpjAppliedField,
  CrmCnpjProfileDTO,
  CrmCnpjRunDTO,
  CrmCompanyEnrichmentDTO,
  CrmCompanyEnrichResultDTO,
} from '@/types/crm-cnpj'
import type { CrmCompanyAddress } from '@/types/crm-company'
import { assertModuleMember, assertModulePrivileged } from './authz'

/** Names the grid fills in when the CNPJ lookup failed at creation time. */
const PLACEHOLDER_NAME = /^Empresa [\d./-]+$/

function isBlankName(name: string): boolean {
  const t = name.trim()
  return t === '' || PLACEHOLDER_NAME.test(t)
}

function hasAddress(address: unknown): boolean {
  return (
    typeof address === 'object' &&
    address !== null &&
    Object.values(address).some((v) => typeof v === 'string' && v.trim() !== '')
  )
}

type EnrichInput = {
  workspaceId: string
  actorId: string
  company: CrmCompany
  overwrite: boolean
}

/** No authorization: callers (route service and worker) check it first. */
export async function enrichCompany(
  input: EnrichInput,
): Promise<Result<CrmCompanyEnrichResultDTO>> {
  const { workspaceId, actorId, company, overwrite } = input

  const digits = normalizeCnpj(company.cnpj ?? '')
  if (!isValidCnpj(digits)) return err(crmCnpjInvalid())

  const provider = getCnpjProvider()
  const profile = await provider.lookup(digits)
  if (!profile.ok) return profile

  const saved = await CrmCompanyEnrichmentRepository.upsert(
    company.id,
    workspaceId,
    toEnrichmentData(profile.value, provider.source),
  )
  if (!saved.ok) return saved

  const applied: CrmCnpjAppliedField[] = []
  const patch: { name?: string; address?: CrmCompanyAddress } = {}

  const name = profile.value.tradeName ?? profile.value.legalName
  if (name && (overwrite || isBlankName(company.name))) {
    patch.name = name
    applied.push('name')
  }
  if (profile.value.address && (overwrite || !hasAddress(company.address))) {
    patch.address = profile.value.address
    applied.push('address')
  }

  let current = company
  if (applied.length > 0) {
    const updated = await CrmCompanyRepository.update(company.id, {
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.address
        ? { address: patch.address as Prisma.InputJsonValue }
        : {}),
      updatedById: actorId,
    })
    if (!updated.ok) return updated
    current = updated.value
    void indexSearchDocument('crm-company', workspaceId, company.id)
  }

  auditMutation({
    entity: 'crm_cnpj_enrichment',
    action: 'update',
    actorId,
    targetId: company.id,
    meta: { applied, overwrite, source: provider.source },
  })

  return ok({
    company: toCrmCompanyDTO(current),
    enrichment: toCrmCompanyEnrichmentDTO(saved.value),
    applied,
  })
}

/**
 * Receita enrichment of one company (CRM). Authorization lives in the public
 * methods; `enrichCompany` is shared with the bulk worker, which has already
 * checked the actor when the run was created.
 */
export const CrmCnpjEnrichmentService = {
  /** Registry preview for a typed CNPJ (nothing is saved). */
  async lookup(
    actorId: string,
    workspaceId: string,
    dto: LookupCnpjDTO,
  ): Promise<Result<CrmCnpjProfileDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'companies',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const digits = normalizeCnpj(dto.cnpj)
    if (!isValidCnpj(digits)) return err(crmCnpjInvalid())

    const profile = await getCnpjProvider().lookup(digits)
    if (!profile.ok) return profile
    return ok(toCrmCnpjProfileDTO(profile.value))
  },

  async getForCompany(
    actorId: string,
    workspaceId: string,
    companyId: string,
  ): Promise<Result<CrmCompanyEnrichmentDTO | null>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'companies',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const company = await CrmCompanyRepository.findById(companyId, workspaceId)
    if (!company.ok) return company

    const row = await CrmCompanyEnrichmentRepository.findByCompany(
      companyId,
      workspaceId,
    )
    if (!row.ok) return row
    return ok(row.value ? toCrmCompanyEnrichmentDTO(row.value) : null)
  },

  /** Fetches the Receita profile of one company and fills what is empty. */
  async enrich(
    actorId: string,
    workspaceId: string,
    companyId: string,
    dto: EnrichCompanyDTO,
  ): Promise<Result<CrmCompanyEnrichResultDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'companies',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const company = await CrmCompanyRepository.findById(companyId, workspaceId)
    if (!company.ok) return company

    return enrichCompany({
      workspaceId,
      actorId,
      company: company.value,
      overwrite: dto.overwrite,
    })
  },

  /** Queues the re-enrichment of the whole base (OWNER/ADMIN). */
  async startRun(
    actorId: string,
    workspaceId: string,
    dto: StartCnpjRunDTO,
  ): Promise<Result<CrmCnpjRunDTO>> {
    const membership = await assertModulePrivileged(actorId, workspaceId, 'CRM')
    if (!membership.ok) return membership

    const active = await CrmCnpjRunRepository.findActive(workspaceId)
    if (!active.ok) return active
    if (active.value) return err(crmCnpjRunActive())

    const total = await CrmCnpjRunRepository.countTargets(
      workspaceId,
      dto.onlyMissing,
    )
    if (!total.ok) return total

    const run = await CrmCnpjRunRepository.create({
      workspaceId,
      createdById: actorId,
      onlyMissing: dto.onlyMissing,
      overwrite: dto.overwrite,
      total: total.value,
    })
    if (!run.ok) return run

    try {
      await getCrmCnpjEnrichmentQueue().add(
        CrmCnpjEnrichmentJob.Run,
        { runId: run.value.id },
        { jobId: `crm-cnpj-run-${run.value.id}` },
      )
    } catch (error) {
      logger.error('crm.cnpj.enqueue_failed', {
        runId: run.value.id,
        cause: error instanceof Error ? error.message : String(error),
      })
      const failed = await CrmCnpjRunRepository.update(run.value.id, {
        status: 'FAILED',
        error: 'Não foi possível enfileirar o reenriquecimento',
        finishedAt: new Date(),
      })
      return ok(toCrmCnpjRunDTO(failed.ok ? failed.value : run.value))
    }

    auditMutation({
      entity: 'crm_cnpj_enrichment',
      action: 'create',
      actorId,
      targetId: run.value.id,
      meta: {
        onlyMissing: dto.onlyMissing,
        overwrite: dto.overwrite,
        total: total.value,
      },
    })

    return ok(toCrmCnpjRunDTO(run.value))
  },

  /**
   * Stops a queued or running bulk run (OWNER/ADMIN). Cooperative: the worker
   * reads the flag between two companies, so the one in flight still ends.
   */
  async cancelRun(
    actorId: string,
    workspaceId: string,
    runId: string,
  ): Promise<Result<CrmCnpjRunDTO>> {
    const membership = await assertModulePrivileged(actorId, workspaceId, 'CRM')
    if (!membership.ok) return membership

    const run = await CrmCnpjRunRepository.requestCancel(runId, workspaceId)
    if (!run.ok) return run

    auditMutation({
      entity: 'crm_cnpj_enrichment',
      action: 'cancel',
      actorId,
      targetId: runId,
      meta: { workspaceId, status: run.value.status },
    })
    return ok(toCrmCnpjRunDTO(run.value))
  },

  async listRuns(
    actorId: string,
    workspaceId: string,
    query: ListCnpjRunsDTO,
  ): Promise<Result<CrmCnpjRunDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'companies',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const runs = await CrmCnpjRunRepository.listByWorkspace(
      workspaceId,
      query.limit,
    )
    if (!runs.ok) return runs
    return ok(runs.value.map(toCrmCnpjRunDTO))
  },

  async getRun(
    actorId: string,
    workspaceId: string,
    runId: string,
  ): Promise<Result<CrmCnpjRunDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'companies',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const run = await CrmCnpjRunRepository.findById(runId, workspaceId)
    if (!run.ok) return run
    return ok(toCrmCnpjRunDTO(run.value))
  },
}
