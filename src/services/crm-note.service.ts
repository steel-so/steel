import { auditMutation } from '@/lib/axiom/audit'
import {
  removeKnowledgeSource,
  scheduleKnowledgeIndex,
} from '@/src/lib/ai/knowledge/index-hooks'
import { ok, type Result } from '@/src/lib/result'
import { toCrmNoteDTO } from '@/src/mappers/crm-note.mapper'
import { CrmNoteRepository } from '@/src/repositories/crm-note.repository'
import type {
  CreateCrmNoteDTO,
  ListCrmNotesDTO,
  UpdateCrmNoteDTO,
} from '@/src/schemas/crm-note.schema'
import type { CrmNoteDTO } from '@/types/crm-note'
import { assertModuleMember } from './authz'
import { recordCrmActivity } from './crm-activity-recorder'
import { dispatchCrmWorkflowRecordEvent } from './crm-workflow-dispatcher'
import { dispatchSteelAgentMentions } from './steel-agent-assignment.service'

export const CrmNoteService = {
  async list(
    actorId: string,
    workspaceId: string,
    filters: ListCrmNotesDTO,
  ): Promise<Result<CrmNoteDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'notes',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result = await CrmNoteRepository.listByWorkspace(workspaceId, filters)
    if (!result.ok) return result

    return ok(result.value.map(toCrmNoteDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmNoteDTO,
  ): Promise<Result<CrmNoteDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'notes',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const result = await CrmNoteRepository.create({
      workspaceId,
      createdById: actorId,
      title: dto.title,
      body: dto.body,
      companyId: dto.companyId,
      personId: dto.personId,
      opportunityId: dto.opportunityId,
    })

    if (!result.ok) {
      auditMutation({
        entity: 'crm_note',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'crm_note',
      action: 'create',
      actorId,
      targetId: result.value.id,
    })

    const createdDto = toCrmNoteDTO(result.value)
    void scheduleKnowledgeIndex('crm-note', workspaceId, result.value.id)
    void dispatchSteelAgentMentions({
      workspaceId,
      actorId,
      event: 'crm.note.agent_mentioned',
      agentIds: dto.mentionedAgentIds,
      payload: {
        noteId: result.value.id,
        title: dto.title ?? null,
        note: (dto.body ?? '').slice(0, 500),
        opportunityId: dto.opportunityId ?? null,
        personId: dto.personId ?? null,
        companyId: dto.companyId ?? null,
        authorId: actorId,
      },
    })
    void recordCrmActivity({
      workspaceId,
      actorUserId: actorId,
      entity: 'note',
      event: 'created',
      record: createdDto,
    })

    void dispatchCrmWorkflowRecordEvent({
      workspaceId,
      actorUserId: actorId,
      entity: 'note',
      event: 'created',
      record: createdDto,
    })

    return ok(createdDto)
  },

  async update(
    actorId: string,
    workspaceId: string,
    noteId: string,
    dto: UpdateCrmNoteDTO,
  ): Promise<Result<CrmNoteDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'notes',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await CrmNoteRepository.findById(noteId, workspaceId)
    if (!existing.ok) return existing

    const result = await CrmNoteRepository.update(noteId, {
      title: dto.title,
      body: dto.body,
      companyId: dto.companyId,
      personId: dto.personId,
      opportunityId: dto.opportunityId,
      updatedById: actorId,
    })
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_note',
      action: 'update',
      actorId,
      targetId: noteId,
      meta: { fields: Object.keys(dto) },
    })

    const updatedDto = toCrmNoteDTO(result.value)
    void scheduleKnowledgeIndex('crm-note', workspaceId, noteId)
    void recordCrmActivity({
      workspaceId,
      actorUserId: actorId,
      entity: 'note',
      event: 'updated',
      record: updatedDto,
    })

    void dispatchCrmWorkflowRecordEvent({
      workspaceId,
      actorUserId: actorId,
      entity: 'note',
      event: 'updated',
      record: updatedDto,
    })

    return ok(updatedDto)
  },

  async remove(
    actorId: string,
    workspaceId: string,
    noteId: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'notes',
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const existing = await CrmNoteRepository.findById(noteId, workspaceId)
    if (!existing.ok) return existing

    const result = await CrmNoteRepository.softDelete(noteId)
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_note',
      action: 'delete',
      actorId,
      targetId: noteId,
    })
    void removeKnowledgeSource('crm-note', workspaceId, noteId)

    void recordCrmActivity({
      workspaceId,
      actorUserId: actorId,
      entity: 'note',
      event: 'deleted',
      record: toCrmNoteDTO(existing.value),
    })

    void dispatchCrmWorkflowRecordEvent({
      workspaceId,
      actorUserId: actorId,
      entity: 'note',
      event: 'deleted',
      record: toCrmNoteDTO(existing.value),
    })

    return ok(undefined)
  },

  async reorder(
    actorId: string,
    workspaceId: string,
    orderedIds: string[],
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'notes',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    return CrmNoteRepository.reorder(workspaceId, orderedIds)
  },
}
