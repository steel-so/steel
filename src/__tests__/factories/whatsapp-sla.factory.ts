import { createId } from '@paralleldrive/cuid2'
import type { WhatsAppSlaCycle, WhatsAppSlaPolicy } from '@prisma/client'
import type { WhatsAppSlaPolicyWithTeam } from '@/src/repositories/whatsapp-sla-policy.repository'

export function createFakeWhatsAppSlaPolicy(
  overrides?: Partial<WhatsAppSlaPolicy> & {
    team?: { id: string; name: string } | null
  },
): WhatsAppSlaPolicyWithTeam {
  const now = new Date()
  const { team, ...rest } = overrides ?? {}
  const teamId = rest.teamId ?? null
  return {
    id: createId(),
    workspaceId: createId(),
    teamId,
    enabled: true,
    firstResponseMinutes: 15,
    resolutionMinutes: 240,
    businessHoursOnly: false,
    warnAtPercent: 80,
    countAiAsResponse: false,
    notifyAssignee: true,
    notifyTeamLeaders: true,
    notifySupervisors: true,
    supervisorIds: [],
    notifyInApp: true,
    notifyEmail: false,
    createdAt: now,
    updatedAt: now,
    ...rest,
    team:
      team !== undefined
        ? team
        : teamId
          ? { id: teamId, name: 'Vendas' }
          : null,
  }
}

export function createFakeWhatsAppSlaCycle(
  overrides?: Partial<WhatsAppSlaCycle>,
): WhatsAppSlaCycle {
  const startedAt = overrides?.startedAt ?? new Date('2026-10-22T12:00:00Z')
  const minute = 60 * 1000
  return {
    id: createId(),
    workspaceId: createId(),
    conversationId: createId(),
    policyId: null,
    teamId: null,
    agentUserId: null,
    businessHoursOnly: false,
    firstResponseMinutes: 15,
    resolutionMinutes: 240,
    countAiAsResponse: false,
    startedAt,
    firstResponseDueAt: new Date(startedAt.getTime() + 15 * minute),
    firstResponseWarnAt: new Date(startedAt.getTime() + 12 * minute),
    resolutionDueAt: new Date(startedAt.getTime() + 240 * minute),
    resolutionWarnAt: new Date(startedAt.getTime() + 192 * minute),
    firstResponseAt: null,
    firstResponseSeconds: null,
    resolvedAt: null,
    firstResponseWarnedAt: null,
    firstResponseBreachedAt: null,
    resolutionWarnedAt: null,
    resolutionBreachedAt: null,
    createdAt: startedAt,
    updatedAt: startedAt,
    ...overrides,
  }
}
