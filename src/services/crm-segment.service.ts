import type { Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import {
  crmSegmentInvalid,
  crmSegmentLimitReached,
  crmSegmentNameTaken,
  crmSegmentNotFound,
} from '@/src/errors'
import type { CampaignCandidate } from '@/src/lib/crm-campaign/audience'
import { err, ok, type Result } from '@/src/lib/result'
import {
  parseStoredSegmentDefinition,
  toCrmSegmentDTO,
} from '@/src/mappers/crm-segment.mapper'
import { CrmSegmentRepository } from '@/src/repositories/crm-segment.repository'
import {
  CRM_SEGMENT_SAMPLE_SIZE,
  CRM_SEGMENTS_PER_WORKSPACE,
  type CreateCrmSegmentDTO,
  type CrmSegmentContactsPageDTO,
  type CrmSegmentDTO,
  type CrmSegmentOptionsDTO,
  type CrmSegmentPreviewDTO,
  type PreviewCrmSegmentDTO,
  type UpdateCrmSegmentDTO,
  validateSegmentDefinition,
} from '@/src/schemas/crm-segment.schema'
import { assertModuleMember } from './authz'

/**
 * Dynamic contact segments (CRM > Segmentação). Permissions follow the
 * e-mail marketing resources (`email`), as mailing lists and campaigns do.
 */

async function guard(
  actorId: string,
  workspaceId: string,
  action: 'VIEW' | 'CREATE' | 'EDIT' | 'DELETE',
) {
  return assertModuleMember(actorId, workspaceId, 'CRM', {
    resource: 'email',
    action,
  })
}

export const CrmSegmentService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmSegmentDTO[]>> {
    const access = await guard(actorId, workspaceId, 'VIEW')
    if (!access.ok) return access
    const rows = await CrmSegmentRepository.list(workspaceId)
    if (!rows.ok) return rows
    return ok(rows.value.map(toCrmSegmentDTO))
  },

  async get(
    actorId: string,
    workspaceId: string,
    segmentId: string,
  ): Promise<Result<CrmSegmentDTO>> {
    const access = await guard(actorId, workspaceId, 'VIEW')
    if (!access.ok) return access
    const found = await CrmSegmentRepository.findById(workspaceId, segmentId)
    if (!found.ok) return found
    if (!found.value) return err(crmSegmentNotFound())
    return ok(toCrmSegmentDTO(found.value))
  },

  async options(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmSegmentOptionsDTO>> {
    const access = await guard(actorId, workspaceId, 'VIEW')
    if (!access.ok) return access
    return CrmSegmentRepository.options(workspaceId)
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmSegmentDTO,
  ): Promise<Result<CrmSegmentDTO>> {
    const access = await guard(actorId, workspaceId, 'CREATE')
    if (!access.ok) return access
    const count = await CrmSegmentRepository.count(workspaceId)
    if (!count.ok) return count
    if (count.value >= CRM_SEGMENTS_PER_WORKSPACE) {
      return err(crmSegmentLimitReached(CRM_SEGMENTS_PER_WORKSPACE))
    }
    const created = await CrmSegmentRepository.create({
      workspaceId,
      name: dto.name,
      description: dto.description?.trim() || null,
      target: dto.target,
      definition: dto.definition as Prisma.InputJsonValue,
      createdById: actorId,
    })
    if (!created.ok) return created
    auditMutation({
      entity: 'crm_segment',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, target: dto.target },
    })
    return ok(toCrmSegmentDTO(created.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    segmentId: string,
    dto: UpdateCrmSegmentDTO,
  ): Promise<Result<CrmSegmentDTO>> {
    const access = await guard(actorId, workspaceId, 'EDIT')
    if (!access.ok) return access
    const found = await CrmSegmentRepository.findById(workspaceId, segmentId)
    if (!found.ok) return found
    if (!found.value) return err(crmSegmentNotFound())

    const target = dto.target ?? found.value.target
    const definition =
      dto.definition ?? parseStoredSegmentDefinition(found.value).definition
    const problem = validateSegmentDefinition(target, definition)
    if (problem) return err(crmSegmentInvalid(problem))

    const updated = await CrmSegmentRepository.update(segmentId, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description?.trim() || null }
        : {}),
      ...(dto.target !== undefined ? { target: dto.target } : {}),
      ...(dto.definition !== undefined
        ? { definition: dto.definition as Prisma.InputJsonValue }
        : {}),
      updatedById: actorId,
    })
    if (!updated.ok) return updated
    auditMutation({
      entity: 'crm_segment',
      action: 'update',
      actorId,
      targetId: segmentId,
      meta: { workspaceId, fields: Object.keys(dto) },
    })
    return ok(toCrmSegmentDTO(updated.value))
  },

  /** Copy of a segment named "<name> (cópia)", numbered when taken. */
  async duplicate(
    actorId: string,
    workspaceId: string,
    segmentId: string,
  ): Promise<Result<CrmSegmentDTO>> {
    const access = await guard(actorId, workspaceId, 'CREATE')
    if (!access.ok) return access
    const found = await CrmSegmentRepository.findById(workspaceId, segmentId)
    if (!found.ok) return found
    if (!found.value) return err(crmSegmentNotFound())
    const count = await CrmSegmentRepository.count(workspaceId)
    if (!count.ok) return count
    if (count.value >= CRM_SEGMENTS_PER_WORKSPACE) {
      return err(crmSegmentLimitReached(CRM_SEGMENTS_PER_WORKSPACE))
    }

    const base = `${found.value.name} (cópia)`.slice(0, 80)
    for (let n = 1; n <= 20; n += 1) {
      const suffix = n === 1 ? '' : ` ${n}`
      const created = await CrmSegmentRepository.create({
        workspaceId,
        name: `${base.slice(0, 80 - suffix.length)}${suffix}`,
        description: found.value.description,
        target: found.value.target,
        definition: found.value.definition as Prisma.InputJsonValue,
        createdById: actorId,
      })
      if (created.ok) {
        auditMutation({
          entity: 'crm_segment',
          action: 'create',
          actorId,
          targetId: created.value.id,
          meta: { workspaceId, duplicatedFrom: segmentId },
        })
        return ok(toCrmSegmentDTO(created.value))
      }
      if (created.error.code !== crmSegmentNameTaken().code) return created
    }
    return err(crmSegmentNameTaken())
  },

  async remove(
    actorId: string,
    workspaceId: string,
    segmentId: string,
  ): Promise<Result<void>> {
    const access = await guard(actorId, workspaceId, 'DELETE')
    if (!access.ok) return access
    const found = await CrmSegmentRepository.findById(workspaceId, segmentId)
    if (!found.ok) return found
    if (!found.value) return err(crmSegmentNotFound())
    const deleted = await CrmSegmentRepository.delete(segmentId)
    if (!deleted.ok) return deleted
    auditMutation({
      entity: 'crm_segment',
      action: 'delete',
      actorId,
      targetId: segmentId,
      meta: { workspaceId, name: found.value.name },
    })
    return ok(undefined)
  },

  /** Live count and sample of rules that may not be saved yet. */
  async preview(
    actorId: string,
    workspaceId: string,
    dto: PreviewCrmSegmentDTO,
  ): Promise<Result<CrmSegmentPreviewDTO>> {
    const access = await guard(actorId, workspaceId, 'VIEW')
    if (!access.ok) return access
    const result = await CrmSegmentRepository.contacts(
      workspaceId,
      dto.target,
      dto.definition,
      0,
      CRM_SEGMENT_SAMPLE_SIZE,
    )
    if (!result.ok) return result
    return ok({ total: result.value.total, sample: result.value.items })
  },

  /** Paginated members of a saved segment. */
  async contacts(
    actorId: string,
    workspaceId: string,
    segmentId: string,
    page: number,
    pageSize: number,
  ): Promise<Result<CrmSegmentContactsPageDTO>> {
    const access = await guard(actorId, workspaceId, 'VIEW')
    if (!access.ok) return access
    const found = await CrmSegmentRepository.findById(workspaceId, segmentId)
    if (!found.ok) return found
    if (!found.value) return err(crmSegmentNotFound())
    const { definition, valid } = parseStoredSegmentDefinition(found.value)
    if (!valid) return err(crmSegmentInvalid())
    const result = await CrmSegmentRepository.contacts(
      workspaceId,
      found.value.target,
      definition,
      (page - 1) * pageSize,
      pageSize,
    )
    if (!result.ok) return result
    return ok({
      total: result.value.total,
      page,
      pageSize,
      items: result.value.items,
    })
  },

  /**
   * Members of the segments at the moment of use (campaigns, e-mails,
   * cadences). No actor check: the caller already authorised the action and
   * applies the opt-outs. A deleted segment contributes nobody; one that
   * no longer parses refuses the whole call instead of mailing a guess.
   */
  async resolveCandidates(
    workspaceId: string,
    segmentIds: string[],
  ): Promise<Result<CampaignCandidate[]>> {
    if (segmentIds.length === 0) return ok([])
    const rows = await CrmSegmentRepository.findManyByIds(
      workspaceId,
      segmentIds,
    )
    if (!rows.ok) return rows
    const candidates: CampaignCandidate[] = []
    for (const segment of rows.value) {
      const { definition, valid } = parseStoredSegmentDefinition(segment)
      if (!valid) {
        return err(
          crmSegmentInvalid(
            `O segmento "${segment.name}" não é mais válido: revise as regras`,
          ),
        )
      }
      const members = await CrmSegmentRepository.candidates(
        workspaceId,
        segment.target,
        definition,
      )
      if (!members.ok) return members
      candidates.push(...members.value)
    }
    return ok(candidates)
  },

  /** `true` when every id is a segment of the workspace. */
  async allExist(
    workspaceId: string,
    segmentIds: string[],
  ): Promise<Result<boolean>> {
    const unique = [...new Set(segmentIds)]
    if (unique.length === 0) return ok(true)
    const rows = await CrmSegmentRepository.findManyByIds(workspaceId, unique)
    if (!rows.ok) return rows
    return ok(rows.value.length === unique.length)
  },
}
