import { auditMutation } from '@/lib/axiom/audit'
import {
  conflict,
  validationError,
  whatsappSlaPolicyNotFound,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { toWhatsAppSlaPolicyDTO } from '@/src/mappers/whatsapp-sla.mapper'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppSlaPolicyRepository } from '@/src/repositories/whatsapp-sla-policy.repository'
import { WhatsAppTeamRepository } from '@/src/repositories/whatsapp-team.repository'
import type {
  CreateWhatsAppSlaPolicyDTO,
  UpdateWhatsAppSlaPolicyDTO,
} from '@/src/schemas/whatsapp-sla.schema'
import type { WhatsAppSlaPolicyDTO } from '@/types/whatsapp-sla'
import { assertModuleMember, assertModulePrivileged } from './authz'

/** Defaults of a new policy (disabled until an admin turns it on). */
export const WHATSAPP_SLA_POLICY_DEFAULTS: {
  enabled: boolean
  firstResponseMinutes: number
  resolutionMinutes: number | null
  businessHoursOnly: boolean
  warnAtPercent: number
  countAiAsResponse: boolean
  notifyAssignee: boolean
  notifyTeamLeaders: boolean
  notifySupervisors: boolean
  supervisorIds: string[]
  notifyInApp: boolean
  notifyEmail: boolean
} = {
  enabled: false,
  firstResponseMinutes: 15,
  resolutionMinutes: null,
  businessHoursOnly: true,
  warnAtPercent: 80,
  countAiAsResponse: false,
  notifyAssignee: true,
  notifyTeamLeaders: true,
  notifySupervisors: true,
  supervisorIds: [],
  notifyInApp: true,
  notifyEmail: false,
}

function checkTargets(
  firstResponseMinutes: number,
  resolutionMinutes: number | null,
): Result<void> {
  if (resolutionMinutes !== null && resolutionMinutes < firstResponseMinutes) {
    return err(
      validationError(
        'O prazo de resolução não pode ser menor que o da primeira resposta',
      ),
    )
  }
  return ok(undefined)
}

async function checkSupervisors(
  workspaceId: string,
  supervisorIds: string[],
): Promise<Result<void>> {
  if (supervisorIds.length === 0) return ok(undefined)
  const members =
    await MembershipRepository.listWithUserByWorkspace(workspaceId)
  if (!members.ok) return members
  const memberIds = new Set(members.value.map((member) => member.userId))
  if (supervisorIds.some((id) => !memberIds.has(id))) {
    return err(
      validationError(
        'Selecione apenas membros deste workspace como supervisores',
      ),
    )
  }
  return ok(undefined)
}

/**
 * Admin CRUD of the Communication SLA policies (ADR 0048): one default per
 * workspace and at most one override per team.
 */
export const WhatsAppSlaPolicyService = {
  /** Default first, then team overrides by team name. */
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppSlaPolicyDTO[]>> {
    const access = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!access.ok) return access

    const rows = await WhatsAppSlaPolicyRepository.listByWorkspace(workspaceId)
    if (!rows.ok) return rows
    return ok(rows.value.map(toWhatsAppSlaPolicyDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateWhatsAppSlaPolicyDTO,
  ): Promise<Result<WhatsAppSlaPolicyDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const teamId = dto.teamId ?? null
    if (teamId) {
      const team = await WhatsAppTeamRepository.findById(teamId, workspaceId)
      if (!team.ok) return team
      if (!team.value) return err(validationError('Equipe não encontrada'))
    }
    const existing = await WhatsAppSlaPolicyRepository.findByScope(
      workspaceId,
      teamId,
    )
    if (!existing.ok) return existing
    if (existing.value) {
      return err(
        conflict(
          teamId
            ? 'Esta equipe já tem uma política de SLA'
            : 'O workspace já tem uma política de SLA padrão',
        ),
      )
    }

    const values = { ...WHATSAPP_SLA_POLICY_DEFAULTS, ...stripUndefined(dto) }
    const targets = checkTargets(
      values.firstResponseMinutes,
      values.resolutionMinutes,
    )
    if (!targets.ok) return targets
    const supervisors = await checkSupervisors(
      workspaceId,
      values.supervisorIds,
    )
    if (!supervisors.ok) return supervisors

    const created = await WhatsAppSlaPolicyRepository.create({
      workspaceId,
      teamId,
      enabled: values.enabled,
      firstResponseMinutes: values.firstResponseMinutes,
      resolutionMinutes: values.resolutionMinutes,
      businessHoursOnly: values.businessHoursOnly,
      warnAtPercent: values.warnAtPercent,
      countAiAsResponse: values.countAiAsResponse,
      notifyAssignee: values.notifyAssignee,
      notifyTeamLeaders: values.notifyTeamLeaders,
      notifySupervisors: values.notifySupervisors,
      supervisorIds: Array.from(new Set(values.supervisorIds)),
      notifyInApp: values.notifyInApp,
      notifyEmail: values.notifyEmail,
    })
    if (!created.ok) return created

    auditMutation({
      entity: 'whatsapp_sla_policy',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, teamId, enabled: created.value.enabled },
    })
    return ok(toWhatsAppSlaPolicyDTO(created.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: UpdateWhatsAppSlaPolicyDTO,
  ): Promise<Result<WhatsAppSlaPolicyDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const existing = await WhatsAppSlaPolicyRepository.findById(id, workspaceId)
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappSlaPolicyNotFound())

    const patch = stripUndefined(dto)
    const targets = checkTargets(
      patch.firstResponseMinutes ?? existing.value.firstResponseMinutes,
      patch.resolutionMinutes === undefined
        ? existing.value.resolutionMinutes
        : patch.resolutionMinutes,
    )
    if (!targets.ok) return targets
    if (patch.supervisorIds) {
      const supervisors = await checkSupervisors(
        workspaceId,
        patch.supervisorIds,
      )
      if (!supervisors.ok) return supervisors
      patch.supervisorIds = Array.from(new Set(patch.supervisorIds))
    }

    const updated = await WhatsAppSlaPolicyRepository.update(id, patch)
    if (!updated.ok) return updated

    auditMutation({
      entity: 'whatsapp_sla_policy',
      action: 'update',
      actorId,
      targetId: id,
      meta: { workspaceId, fields: Object.keys(patch) },
    })
    return ok(toWhatsAppSlaPolicyDTO(updated.value))
  },

  /** Removes the policy; cycles already running keep their snapshot. */
  async remove(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<{ id: string }>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const existing = await WhatsAppSlaPolicyRepository.findById(id, workspaceId)
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappSlaPolicyNotFound())

    const deleted = await WhatsAppSlaPolicyRepository.delete(id)
    if (!deleted.ok) return deleted

    auditMutation({
      entity: 'whatsapp_sla_policy',
      action: 'delete',
      actorId,
      targetId: id,
      meta: { workspaceId, teamId: existing.value.teamId },
    })
    return ok({ id })
  },
}

/** Drops the keys a PATCH-like DTO left out. */
function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>
}
