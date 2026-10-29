import type { SteelAgent, SteelAgentAssignmentEntity } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { steelAgentDisabled } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import {
  SteelAgentAssignmentRepository,
  SteelAgentRepository,
} from '@/src/repositories/steel-agent.repository'
import type { AssignSteelAgentDTO } from '@/src/schemas/steel-agent.schema'
import type { SteelAgentAssignmentDTO } from '@/types/steel-agent'
import { assertModuleMember } from './authz'
import { loadSdTicketTab } from './sd-ticket-tab-support'
import { dispatchSteelAgentDirect } from './steel-agent-dispatcher'

/**
 * "Atribuir ao agente": a ticket or a lead handed to a Steel Agent. The actor
 * needs EDIT on the record's resource (`sd-tickets` / `leads`); the agent
 * must belong to the workspace and be switched on. Assigning (or changing)
 * queues a run for the agent with the record as context; removing does not
 * run anything.
 */

type Entity = SteelAgentAssignmentEntity

interface RecordRef {
  entityType: Entity
  entityId: string
  /** Payload handed to the agent run. */
  payload: Record<string, unknown>
}

async function resolveRecord(
  actorId: string,
  workspaceId: string,
  entityType: Entity,
  ref: string,
  write: boolean,
): Promise<Result<RecordRef>> {
  if (entityType === 'SD_TICKET') {
    const scope = await loadSdTicketTab(
      actorId,
      workspaceId,
      ref,
      write ? 'EDIT' : 'VIEW',
      { agentOnly: true, requireOpen: write },
    )
    if (!scope.ok) return scope
    const { ticket, code } = scope.value
    return ok({
      entityType,
      entityId: ticket.id,
      payload: { ticketId: ticket.id, code, title: ticket.title },
    })
  }
  const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
    resource: 'leads',
    action: write ? 'EDIT' : 'VIEW',
  })
  if (!membership.ok) return membership
  const lead = await CrmLeadRepository.findById(ref, workspaceId)
  if (!lead.ok) return lead
  return ok({
    entityType,
    entityId: lead.value.id,
    payload: { leadId: lead.value.id, name: lead.value.name },
  })
}

function toDTO(
  entityType: Entity,
  entityId: string,
  agent: Pick<SteelAgent, 'id' | 'name' | 'enabled'> | null,
  assignedAt: Date | null,
): SteelAgentAssignmentDTO {
  return {
    entityType,
    entityId,
    agent: agent
      ? { id: agent.id, name: agent.name, enabled: agent.enabled }
      : null,
    assignedAt: assignedAt?.toISOString() ?? null,
  }
}

export const SteelAgentAssignmentService = {
  async get(
    actorId: string,
    workspaceId: string,
    entityType: Entity,
    ref: string,
  ): Promise<Result<SteelAgentAssignmentDTO>> {
    const record = await resolveRecord(
      actorId,
      workspaceId,
      entityType,
      ref,
      false,
    )
    if (!record.ok) return record
    const row = await SteelAgentAssignmentRepository.find(
      entityType,
      record.value.entityId,
      workspaceId,
    )
    if (!row.ok) return row
    if (!row.value) {
      return ok(toDTO(entityType, record.value.entityId, null, null))
    }
    const agent = await SteelAgentRepository.findById(
      row.value.agentId,
      workspaceId,
    )
    return ok(
      toDTO(
        entityType,
        record.value.entityId,
        agent.ok ? agent.value : null,
        agent.ok ? row.value.createdAt : null,
      ),
    )
  },

  async assign(
    actorId: string,
    workspaceId: string,
    entityType: Entity,
    ref: string,
    dto: AssignSteelAgentDTO,
  ): Promise<Result<SteelAgentAssignmentDTO>> {
    const record = await resolveRecord(
      actorId,
      workspaceId,
      entityType,
      ref,
      true,
    )
    if (!record.ok) return record
    const { entityId, payload } = record.value

    if (dto.agentId === null) {
      const removed = await SteelAgentAssignmentRepository.remove(
        entityType,
        entityId,
        workspaceId,
      )
      if (!removed.ok) return removed
      auditMutation({
        entity: 'steel_agent_assignment',
        action: 'delete',
        actorId,
        targetId: entityId,
        meta: { workspaceId, entityType },
      })
      return ok(toDTO(entityType, entityId, null, null))
    }

    const agent = await SteelAgentRepository.findById(dto.agentId, workspaceId)
    if (!agent.ok) return agent
    if (!agent.value.enabled) return err(steelAgentDisabled())

    const saved = await SteelAgentAssignmentRepository.upsert({
      workspaceId,
      agentId: agent.value.id,
      entityType,
      entityId,
      assignedById: actorId,
    })
    if (!saved.ok) return saved
    auditMutation({
      entity: 'steel_agent_assignment',
      action: 'update',
      actorId,
      targetId: entityId,
      meta: { workspaceId, entityType, agentId: agent.value.id },
    })
    void dispatchSteelAgentDirect(
      workspaceId,
      agent.value.id,
      entityType === 'SD_TICKET'
        ? 'sd.ticket.agent_assigned'
        : 'crm.lead.agent_assigned',
      { ...payload, assignedById: actorId },
      actorId,
    )
    return ok(toDTO(entityType, entityId, agent.value, saved.value.createdAt))
  },
}

/**
 * Wakes the agents cited with `@` in a comment. Invalid, foreign or paused
 * agents are ignored silently. Returns the ids that were queued. Never throws.
 */
export async function dispatchSteelAgentMentions(input: {
  workspaceId: string
  actorId: string
  event: 'sd.ticket.agent_mentioned' | 'crm.note.agent_mentioned'
  agentIds: readonly string[] | undefined
  payload: Record<string, unknown>
}): Promise<string[]> {
  const ids = Array.from(new Set(input.agentIds ?? []))
  if (ids.length === 0) return []
  const agents = await SteelAgentRepository.listEnabledByIds(
    input.workspaceId,
    ids,
  )
  if (!agents.ok) return []
  const queued: string[] = []
  for (const agent of agents.value) {
    const ok = await dispatchSteelAgentDirect(
      input.workspaceId,
      agent.id,
      input.event,
      input.payload,
      input.actorId,
    )
    if (ok) queued.push(agent.id)
  }
  return queued
}
