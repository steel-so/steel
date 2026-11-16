import type { CrmCompany, Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { isValidCnpj, normalizeCnpj } from '@/src/lib/crm-cnpj'
import { ok, type Result } from '@/src/lib/result'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import { toCrmCompanyDTO } from '@/src/mappers/crm-company.mapper'
import { CrmCompanyRepository } from '@/src/repositories/crm-company.repository'
import type {
  CreateCrmCompanyDTO,
  ListCrmCompaniesDTO,
  UpdateCrmCompanyDTO,
} from '@/src/schemas/crm-company.schema'
import type { CrmCompanyDTO } from '@/types/crm-company'
import { assertModuleMember } from './authz'
import { recordCrmActivity } from './crm-activity-recorder'
import {
  applyCustomFieldValues,
  withCustomFields,
  withCustomFieldsList,
} from './crm-custom-field-sync'
import { CrmDuplicateService } from './crm-duplicate.service'
import { dispatchCrmWorkflowRecordEvent } from './crm-workflow-dispatcher'
import { emitEntityWebhook } from './webhook-entity-events'

/**
 * Fills everything blank from the Receita right after a write. Never fails
 * the caller: an unavailable lookup just keeps the plain record.
 */
async function tryEnrich(
  actorId: string,
  workspaceId: string,
  company: CrmCompany,
): Promise<CrmCompanyDTO | null> {
  try {
    // Lazy: the enrichment service pulls the queue/Redis modules, which the
    // many callers of this service should not load unless a lookup happens.
    const { enrichCompany } = await import('./crm-cnpj-enrichment.service')
    const enriched = await enrichCompany({
      workspaceId,
      actorId,
      company,
      overwrite: false,
    })
    if (enriched.ok) return enriched.value.company
    logger.warn('crm.company.enrich_skipped', {
      companyId: company.id,
      code: enriched.error.code,
    })
  } catch (error) {
    logger.warn('crm.company.enrich_skipped', {
      companyId: company.id,
      cause: error instanceof Error ? error.message : String(error),
    })
  }
  return null
}

/** Registry columns shared by create and update (undefined = untouched). */
function registryFields(dto: CreateCrmCompanyDTO | UpdateCrmCompanyDTO) {
  return {
    legalName: dto.legalName,
    tradeName: dto.tradeName,
    emails: dto.emails,
    phones: dto.phones,
    cnaeCode: dto.cnaeCode,
    cnaeDescription: dto.cnaeDescription,
    size: dto.size,
    legalNature: dto.legalNature,
    registrationStatus: dto.registrationStatus,
    openedAt: dto.openedAt,
    shareCapital: dto.shareCapital,
  }
}

export const CrmCompanyService = {
  async list(
    actorId: string,
    workspaceId: string,
    filters: ListCrmCompaniesDTO,
  ): Promise<Result<CrmCompanyDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'companies',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result = await CrmCompanyRepository.listByWorkspace(workspaceId, {
      icp: filters.icp,
    })
    if (!result.ok) return result

    return withCustomFieldsList(result.value.map(toCrmCompanyDTO))
  },

  async getById(
    actorId: string,
    workspaceId: string,
    companyId: string,
  ): Promise<Result<CrmCompanyDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'companies',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result = await CrmCompanyRepository.findById(companyId, workspaceId)
    if (!result.ok) return result

    return withCustomFields(toCrmCompanyDTO(result.value))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmCompanyDTO,
    options: { enrich?: boolean } = {},
  ): Promise<Result<CrmCompanyDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'companies',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const result = await CrmCompanyRepository.create({
      workspaceId,
      createdById: actorId,
      name: dto.name,
      cnpj: dto.cnpj,
      domain: dto.domain,
      employees: dto.employees,
      linkedin: dto.linkedin,
      address: dto.address as Prisma.InputJsonValue | undefined,
      arr: dto.arr,
      icp: dto.icp,
      accountOwnerId: dto.accountOwnerId,
      ...registryFields(dto as CreateCrmCompanyDTO),
    })

    if (!result.ok) {
      auditMutation({
        entity: 'crm_company',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'crm_company',
      action: 'create',
      actorId,
      targetId: result.value.id,
    })

    if (dto.customFields) {
      const applied = await applyCustomFieldValues(
        workspaceId,
        'COMPANY',
        result.value.id,
        dto.customFields,
      )
      if (!applied.ok) return applied
    }

    // Complete the record from the CNPJ (values the caller sent always win).
    const enriched =
      (options.enrich ?? true) && dto.cnpj && isValidCnpj(dto.cnpj)
        ? await tryEnrich(actorId, workspaceId, result.value)
        : null

    const merged = await withCustomFields(
      enriched ?? toCrmCompanyDTO(result.value),
    )
    if (!merged.ok) return merged

    void recordCrmActivity({
      workspaceId,
      actorUserId: actorId,
      entity: 'company',
      event: 'created',
      record: merged.value,
    })

    void dispatchCrmWorkflowRecordEvent({
      workspaceId,
      actorUserId: actorId,
      entity: 'company',
      event: 'created',
      record: merged.value,
    })

    void indexSearchDocument('crm-company', workspaceId, merged.value.id)
    void emitEntityWebhook(workspaceId, actorId, {
      entity: 'company',
      action: 'created',
      record: merged.value,
    })
    void CrmDuplicateService.flagOnArrival(
      workspaceId,
      'COMPANY',
      merged.value.id,
    )
    return ok(merged.value)
  },

  async update(
    actorId: string,
    workspaceId: string,
    companyId: string,
    dto: UpdateCrmCompanyDTO,
  ): Promise<Result<CrmCompanyDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'companies',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await CrmCompanyRepository.findById(companyId, workspaceId)
    if (!existing.ok) return existing

    const result = await CrmCompanyRepository.update(companyId, {
      name: dto.name,
      cnpj: dto.cnpj,
      domain: dto.domain,
      employees: dto.employees,
      linkedin: dto.linkedin,
      address: dto.address as Prisma.InputJsonValue | null | undefined,
      arr: dto.arr,
      icp: dto.icp,
      accountOwnerId: dto.accountOwnerId,
      ...registryFields(dto),
      updatedById: actorId,
    })

    if (!result.ok) {
      auditMutation({
        entity: 'crm_company',
        action: 'update',
        actorId,
        targetId: companyId,
        outcome: 'failure',
        reason: result.error.code,
        meta: { fields: Object.keys(dto) },
      })
      return result
    }

    auditMutation({
      entity: 'crm_company',
      action: 'update',
      actorId,
      targetId: companyId,
      meta: { fields: Object.keys(dto) },
    })

    if (dto.customFields) {
      const applied = await applyCustomFieldValues(
        workspaceId,
        'COMPANY',
        companyId,
        dto.customFields,
      )
      if (!applied.ok) return applied
    }

    // A new valid CNPJ fills what is still blank from the Receita.
    const cnpjChanged =
      typeof dto.cnpj === 'string' &&
      isValidCnpj(dto.cnpj) &&
      normalizeCnpj(dto.cnpj) !== normalizeCnpj(existing.value.cnpj ?? '')
    const enriched = cnpjChanged
      ? await tryEnrich(actorId, workspaceId, result.value)
      : null

    const merged = await withCustomFields(
      enriched ?? toCrmCompanyDTO(result.value),
    )
    if (!merged.ok) return merged

    void recordCrmActivity({
      workspaceId,
      actorUserId: actorId,
      entity: 'company',
      event: 'updated',
      record: merged.value,
    })

    void dispatchCrmWorkflowRecordEvent({
      workspaceId,
      actorUserId: actorId,
      entity: 'company',
      event: 'updated',
      record: merged.value,
    })

    void indexSearchDocument('crm-company', workspaceId, companyId)
    void emitEntityWebhook(workspaceId, actorId, {
      entity: 'company',
      action: 'updated',
      record: merged.value,
    })
    return ok(merged.value)
  },

  async remove(
    actorId: string,
    workspaceId: string,
    companyId: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'companies',
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const existing = await CrmCompanyRepository.findById(companyId, workspaceId)
    if (!existing.ok) return existing

    const result = await CrmCompanyRepository.softDelete(companyId)
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_company',
      action: 'delete',
      actorId,
      targetId: companyId,
    })

    void recordCrmActivity({
      workspaceId,
      actorUserId: actorId,
      entity: 'company',
      event: 'deleted',
      record: toCrmCompanyDTO(existing.value),
    })

    void dispatchCrmWorkflowRecordEvent({
      workspaceId,
      actorUserId: actorId,
      entity: 'company',
      event: 'deleted',
      record: toCrmCompanyDTO(existing.value),
    })

    void indexSearchDocument('crm-company', workspaceId, companyId)
    void emitEntityWebhook(workspaceId, actorId, {
      entity: 'company',
      action: 'deleted',
      record: toCrmCompanyDTO(existing.value),
    })
    return ok(undefined)
  },

  async reorder(
    actorId: string,
    workspaceId: string,
    orderedIds: string[],
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'companies',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    return CrmCompanyRepository.reorder(workspaceId, orderedIds)
  },
}
