import {
  type SlaState,
  slaTargetState,
  worstSlaState,
} from '@/src/lib/whatsapp/sla-time'
import type { WhatsAppSlaOpenCycle } from '@/src/repositories/whatsapp-sla-cycle.repository'
import type { WhatsAppSlaPolicyWithTeam } from '@/src/repositories/whatsapp-sla-policy.repository'
import type {
  WhatsAppSlaOpenCycleDTO,
  WhatsAppSlaPolicyDTO,
} from '@/types/whatsapp-sla'

export function toWhatsAppSlaPolicyDTO(
  policy: WhatsAppSlaPolicyWithTeam,
): WhatsAppSlaPolicyDTO {
  return {
    id: policy.id,
    teamId: policy.teamId,
    teamName: policy.team?.name ?? null,
    enabled: policy.enabled,
    firstResponseMinutes: policy.firstResponseMinutes,
    resolutionMinutes: policy.resolutionMinutes,
    businessHoursOnly: policy.businessHoursOnly,
    warnAtPercent: policy.warnAtPercent,
    countAiAsResponse: policy.countAiAsResponse,
    notifyAssignee: policy.notifyAssignee,
    notifyTeamLeaders: policy.notifyTeamLeaders,
    notifySupervisors: policy.notifySupervisors,
    supervisorIds: policy.supervisorIds,
    notifyInApp: policy.notifyInApp,
    notifyEmail: policy.notifyEmail,
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString(),
  }
}

/**
 * Open cycle as the chip and the list filter read it. A target already met
 * (first response given) is reported `OK` and no longer counts toward the
 * overall state.
 */
export function toWhatsAppSlaOpenCycleDTO(
  cycle: Pick<
    WhatsAppSlaOpenCycle,
    | 'id'
    | 'conversationId'
    | 'startedAt'
    | 'firstResponseAt'
    | 'firstResponseDueAt'
    | 'firstResponseWarnAt'
    | 'resolutionDueAt'
    | 'resolutionWarnAt'
  >,
  now: Date,
): WhatsAppSlaOpenCycleDTO {
  const firstState: SlaState = cycle.firstResponseAt
    ? 'OK'
    : slaTargetState(
        { warnAt: cycle.firstResponseWarnAt, dueAt: cycle.firstResponseDueAt },
        now,
      )
  const resolution =
    cycle.resolutionDueAt && cycle.resolutionWarnAt
      ? {
          dueAt: cycle.resolutionDueAt.toISOString(),
          warnAt: cycle.resolutionWarnAt.toISOString(),
          doneAt: null,
          state: slaTargetState(
            { warnAt: cycle.resolutionWarnAt, dueAt: cycle.resolutionDueAt },
            now,
          ),
        }
      : null

  return {
    cycleId: cycle.id,
    conversationId: cycle.conversationId,
    startedAt: cycle.startedAt.toISOString(),
    firstResponse: {
      dueAt: cycle.firstResponseDueAt.toISOString(),
      warnAt: cycle.firstResponseWarnAt.toISOString(),
      doneAt: cycle.firstResponseAt?.toISOString() ?? null,
      state: firstState,
    },
    resolution,
    state: worstSlaState(firstState, resolution?.state ?? 'OK'),
  }
}
