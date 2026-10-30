import type { Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
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

    const merged = await withCustomFields(toCrmCompanyDTO(result.value))
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

    const merged = await withCustomFields(toCrmCompanyDTO(result.value))
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
