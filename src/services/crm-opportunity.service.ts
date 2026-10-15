import { auditMutation } from '@/lib/axiom/audit'
import { badRequest, crmPipelineNotFound } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import {
  toCrmOpportunityDTO,
  toCrmOpportunityLineItemDTO,
} from '@/src/mappers/crm-opportunity.mapper'
import {
  CrmOpportunityLineItemRepository,
  CrmOpportunityRepository,
} from '@/src/repositories/crm-opportunity.repository'
import {
  CrmPipelineRepository,
  CrmPipelineStageRepository,
} from '@/src/repositories/crm-pipeline.repository'
import { CrmProductRepository } from '@/src/repositories/crm-product.repository'
import type {
  CreateCrmOpportunityDTO,
  CreateCrmOpportunityLineItemDTO,
  UpdateCrmOpportunityDTO,
  UpdateCrmOpportunityLineItemDTO,
} from '@/src/schemas/crm-opportunity.schema'
import type {
  CrmOpportunityDTO,
  CrmOpportunityLineItemDTO,
} from '@/types/crm-opportunity'
import { assertModuleMember } from './authz'
import { recordCrmActivity } from './crm-activity-recorder'
import {
  applyCustomFieldValues,
  withCustomFields,
  withCustomFieldsList,
} from './crm-custom-field-sync'
import { notifyCrmOpportunityAssigned } from './crm-notifications'
import { CrmPipelineService } from './crm-pipeline.service'
import { dispatchCrmWorkflowRecordEvent } from './crm-workflow-dispatcher'

/** `won`: the stage is of category WON (stamps `wonAt`, ADR 0031). */
type StageRefs = { pipelineId: string; stageId: string; won?: boolean }

/** Primeira etapa (categoria OPEN, ou a primeira por posição) do pipeline. */
async function firstStageOf(
  workspaceId: string,
  pipelineId: string,
): Promise<Result<{ id: string; won: boolean }>> {
  const pipeline = await CrmPipelineRepository.findById(pipelineId, workspaceId)
  if (!pipeline.ok) return pipeline

  const stages = await CrmPipelineStageRepository.listByPipeline(pipelineId)
  if (!stages.ok) return stages
  if (stages.value.length === 0) return err(crmPipelineNotFound())

  const ordered = [...stages.value].sort((a, b) => a.position - b.position)
  const stage = ordered.find((s) => s.category === 'OPEN') ?? ordered[0]
  return ok({ id: stage.id, won: stage.category === 'WON' })
}

/**
 * Valida que `stageId` pertence ao `pipelineId` informado e à workspace;
 * devolve se a etapa é de ganho.
 */
async function assertStage(
  workspaceId: string,
  pipelineId: string,
  stageId: string,
): Promise<Result<{ won: boolean }>> {
  const pipeline = await CrmPipelineRepository.findById(pipelineId, workspaceId)
  if (!pipeline.ok) return pipeline

  const stage = await CrmPipelineStageRepository.findById(stageId, pipelineId)
  if (!stage.ok) return stage

  return ok({ won: stage.value.category === 'WON' })
}

/** Resolve pipeline+etapa para a criação, aplicando os defaults da workspace. */
async function resolveStageForCreate(
  workspaceId: string,
  input: { pipelineId?: string; stageId?: string },
): Promise<Result<StageRefs>> {
  if (input.stageId) {
    if (!input.pipelineId) {
      return err(badRequest('Informe o pipeline ao definir a etapa'))
    }
    const valid = await assertStage(
      workspaceId,
      input.pipelineId,
      input.stageId,
    )
    if (!valid.ok) return valid
    return ok({
      pipelineId: input.pipelineId,
      stageId: input.stageId,
      won: valid.value.won,
    })
  }
  if (input.pipelineId) {
    const stage = await firstStageOf(workspaceId, input.pipelineId)
    if (!stage.ok) return stage
    return ok({
      pipelineId: input.pipelineId,
      stageId: stage.value.id,
      won: stage.value.won,
    })
  }
  return CrmPipelineService.resolveDefaultStage(workspaceId)
}

/**
 * Resolve pipeline+etapa para a atualização. Retorna `null` quando nem
 * pipelineId nem stageId foram informados (nada a mudar). Quando só
 * pipelineId muda, a etapa é resolvida para a primeira do pipeline alvo.
 */
async function resolveStageForUpdate(
  workspaceId: string,
  currentPipelineId: string,
  input: { pipelineId?: string; stageId?: string },
): Promise<Result<StageRefs | null>> {
  if (input.pipelineId === undefined && input.stageId === undefined) {
    return ok(null)
  }
  const targetPipelineId = input.pipelineId ?? currentPipelineId
  if (input.stageId !== undefined) {
    const valid = await assertStage(
      workspaceId,
      targetPipelineId,
      input.stageId,
    )
    if (!valid.ok) return valid
    return ok({
      pipelineId: targetPipelineId,
      stageId: input.stageId,
      won: valid.value.won,
    })
  }
  const stage = await firstStageOf(workspaceId, targetPipelineId)
  if (!stage.ok) return stage
  return ok({
    pipelineId: targetPipelineId,
    stageId: stage.value.id,
    won: stage.value.won,
  })
}

/**
 * `wonAt` after a stage change: stamped when the deal enters a WON stage
 * (kept when it was already won), cleared when it leaves one. `undefined`
 * leaves the column alone.
 */
function nextWonAt(
  refs: StageRefs | null,
  current: Date | null,
): Date | null | undefined {
  if (!refs) return undefined
  if (refs.won) return current ?? new Date()
  return current === null ? undefined : null
}

export const CrmOpportunityService = {
  async list(
    actorId: string,
    workspaceId: string,
    filters: { pipelineId?: string; stageId?: string },
  ): Promise<Result<CrmOpportunityDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result = await CrmOpportunityRepository.listByWorkspace(
      workspaceId,
      filters,
    )
    if (!result.ok) return result

    return withCustomFieldsList(result.value.map(toCrmOpportunityDTO))
  },

  async getById(
    actorId: string,
    workspaceId: string,
    opportunityId: string,
  ): Promise<Result<CrmOpportunityDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result = await CrmOpportunityRepository.findById(
      opportunityId,
      workspaceId,
    )
    if (!result.ok) return result

    return withCustomFields(toCrmOpportunityDTO(result.value))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmOpportunityDTO,
  ): Promise<Result<CrmOpportunityDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const stageRefs = await resolveStageForCreate(workspaceId, {
      pipelineId: dto.pipelineId,
      stageId: dto.stageId,
    })
    if (!stageRefs.ok) return stageRefs

    const result = await CrmOpportunityRepository.create({
      workspaceId,
      createdById: actorId,
      name: dto.name,
      amount: dto.amount,
      probability: dto.probability,
      closeDate: dto.closeDate,
      pipelineId: stageRefs.value.pipelineId,
      stageId: stageRefs.value.stageId,
      companyId: dto.companyId,
      pointOfContactId: dto.pointOfContactId,
      ownerId: dto.ownerId,
      source: dto.source,
      ...(stageRefs.value.won ? { wonAt: new Date() } : {}),
    })

    if (!result.ok) {
      auditMutation({
        entity: 'crm_opportunity',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'crm_opportunity',
      action: 'create',
      actorId,
      targetId: result.value.id,
    })

    if (dto.customFields) {
      const applied = await applyCustomFieldValues(
        workspaceId,
        'OPPORTUNITY',
        result.value.id,
        dto.customFields,
      )
      if (!applied.ok) return applied
    }

    const merged = await withCustomFields(toCrmOpportunityDTO(result.value))
    if (!merged.ok) return merged

    void recordCrmActivity({
      workspaceId,
      actorUserId: actorId,
      entity: 'opportunity',
      event: 'created',
      record: merged.value,
    })

    void dispatchCrmWorkflowRecordEvent({
      workspaceId,
      actorUserId: actorId,
      entity: 'opportunity',
      event: 'created',
      record: merged.value,
    })

    void indexSearchDocument('crm-opportunity', workspaceId, merged.value.id)
    return ok(merged.value)
  },

  async update(
    actorId: string,
    workspaceId: string,
    opportunityId: string,
    dto: UpdateCrmOpportunityDTO,
  ): Promise<Result<CrmOpportunityDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await CrmOpportunityRepository.findById(
      opportunityId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const stageRefs = await resolveStageForUpdate(
      workspaceId,
      existing.value.pipelineId,
      { pipelineId: dto.pipelineId, stageId: dto.stageId },
    )
    if (!stageRefs.ok) return stageRefs
    const wonAt = nextWonAt(stageRefs.value, existing.value.wonAt)

    const result = await CrmOpportunityRepository.update(opportunityId, {
      name: dto.name,
      amount: dto.amount,
      probability: dto.probability,
      closeDate: dto.closeDate,
      pipelineId: stageRefs.value?.pipelineId,
      stageId: stageRefs.value?.stageId,
      companyId: dto.companyId,
      pointOfContactId: dto.pointOfContactId,
      ownerId: dto.ownerId,
      source: dto.source,
      updatedById: actorId,
      ...(wonAt !== undefined ? { wonAt } : {}),
    })
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_opportunity',
      action: 'update',
      actorId,
      targetId: opportunityId,
      meta: { fields: Object.keys(dto) },
    })

    if (dto.customFields) {
      const applied = await applyCustomFieldValues(
        workspaceId,
        'OPPORTUNITY',
        opportunityId,
        dto.customFields,
      )
      if (!applied.ok) return applied
    }

    const updatedMerged = await withCustomFields(
      toCrmOpportunityDTO(result.value),
    )
    if (!updatedMerged.ok) return updatedMerged

    void recordCrmActivity({
      workspaceId,
      actorUserId: actorId,
      entity: 'opportunity',
      event: 'updated',
      record: updatedMerged.value,
    })

    void dispatchCrmWorkflowRecordEvent({
      workspaceId,
      actorUserId: actorId,
      entity: 'opportunity',
      event: 'updated',
      record: updatedMerged.value,
    })

    if (
      result.value.ownerId &&
      result.value.ownerId !== existing.value.ownerId
    ) {
      void notifyCrmOpportunityAssigned({
        workspaceId,
        opportunity: result.value,
        ownerId: result.value.ownerId,
        actorId,
      })
    }

    void indexSearchDocument('crm-opportunity', workspaceId, opportunityId)
    return ok(updatedMerged.value)
  },

  async remove(
    actorId: string,
    workspaceId: string,
    opportunityId: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const existing = await CrmOpportunityRepository.findById(
      opportunityId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const result = await CrmOpportunityRepository.softDelete(opportunityId)
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_opportunity',
      action: 'delete',
      actorId,
      targetId: opportunityId,
    })

    void recordCrmActivity({
      workspaceId,
      actorUserId: actorId,
      entity: 'opportunity',
      event: 'deleted',
      record: toCrmOpportunityDTO(existing.value),
    })

    void dispatchCrmWorkflowRecordEvent({
      workspaceId,
      actorUserId: actorId,
      entity: 'opportunity',
      event: 'deleted',
      record: toCrmOpportunityDTO(existing.value),
    })

    void indexSearchDocument('crm-opportunity', workspaceId, opportunityId)
    return ok(undefined)
  },

  async reorderInStage(
    actorId: string,
    workspaceId: string,
    stageId: string,
    orderedIds: string[],
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    return CrmOpportunityRepository.reorderInStage(stageId, orderedIds)
  },

  async reorder(
    actorId: string,
    workspaceId: string,
    orderedIds: string[],
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    return CrmOpportunityRepository.reorder(workspaceId, orderedIds)
  },
}

export const CrmOpportunityLineItemService = {
  async list(
    actorId: string,
    workspaceId: string,
    opportunityId: string,
  ): Promise<Result<CrmOpportunityLineItemDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const opportunity = await CrmOpportunityRepository.findById(
      opportunityId,
      workspaceId,
    )
    if (!opportunity.ok) return opportunity

    const result =
      await CrmOpportunityLineItemRepository.listByOpportunity(opportunityId)
    if (!result.ok) return result

    return ok(result.value.map(toCrmOpportunityLineItemDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    opportunityId: string,
    dto: CreateCrmOpportunityLineItemDTO,
  ): Promise<Result<CrmOpportunityLineItemDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const opportunity = await CrmOpportunityRepository.findById(
      opportunityId,
      workspaceId,
    )
    if (!opportunity.ok) return opportunity

    const result = await CrmOpportunityLineItemRepository.create({
      opportunityId,
      productId: dto.productId,
      name: dto.name,
      quantity: dto.quantity,
      unitPrice: dto.unitPrice,
      discountPct: dto.discountPct,
      billingType: dto.billingType,
    })

    if (!result.ok) {
      auditMutation({
        entity: 'crm_opportunity_line_item',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'crm_opportunity_line_item',
      action: 'create',
      actorId,
      targetId: result.value.id,
    })

    return ok(toCrmOpportunityLineItemDTO(result.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    opportunityId: string,
    lineItemId: string,
    dto: UpdateCrmOpportunityLineItemDTO,
  ): Promise<Result<CrmOpportunityLineItemDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const opportunity = await CrmOpportunityRepository.findById(
      opportunityId,
      workspaceId,
    )
    if (!opportunity.ok) return opportunity

    const existing = await CrmOpportunityLineItemRepository.findById(
      lineItemId,
      opportunityId,
    )
    if (!existing.ok) return existing

    // Trocar o produto atualiza o item no lugar (sem apagar/recriar), usando o
    // snapshot do produto para os campos que o cliente não enviou.
    let data = dto
    if (dto.productId && dto.productId !== existing.value.productId) {
      const product = await CrmProductRepository.findById(
        dto.productId,
        workspaceId,
      )
      if (!product.ok) return product
      data = {
        ...dto,
        name: dto.name ?? product.value.name,
        unitPrice: dto.unitPrice ?? Number(product.value.unitPrice),
        billingType: dto.billingType ?? product.value.billingType,
      }
    }

    const result = await CrmOpportunityLineItemRepository.update(
      lineItemId,
      data,
    )
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_opportunity_line_item',
      action: 'update',
      actorId,
      targetId: lineItemId,
      meta: { fields: Object.keys(dto) },
    })

    return ok(toCrmOpportunityLineItemDTO(result.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    opportunityId: string,
    lineItemId: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const opportunity = await CrmOpportunityRepository.findById(
      opportunityId,
      workspaceId,
    )
    if (!opportunity.ok) return opportunity

    const existing = await CrmOpportunityLineItemRepository.findById(
      lineItemId,
      opportunityId,
    )
    if (!existing.ok) return existing

    const result = await CrmOpportunityLineItemRepository.delete(lineItemId)
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_opportunity_line_item',
      action: 'delete',
      actorId,
      targetId: lineItemId,
    })

    return ok(undefined)
  },
}
