import { createId } from '@paralleldrive/cuid2'
import type {
  WaDashboardAttendance,
  WaDashboardEvent,
  WaDashboardSlaCycle,
  WaDashboardTeamMember,
} from '@/src/repositories/whatsapp-dashboard-attendance.repository'

export function createFakeWaDashboardAttendance(
  overrides?: Partial<WaDashboardAttendance>,
): WaDashboardAttendance {
  return {
    id: createId(),
    status: 'IN_PROGRESS',
    assignedUserId: null,
    aiActive: false,
    aiHandoff: false,
    unreadCount: 0,
    avgSentimentScore: null,
    lastMessageAt: new Date('2026-11-17T12:30:00.000Z'),
    lastInboundAt: new Date('2026-11-17T12:30:00.000Z'),
    archivedAt: null,
    closedAt: null,
    closeReason: null,
    closeOutcome: null,
    closeStatusLabels: [],
    firstInboundAt: null,
    firstResponseAt: null,
    createdAt: new Date('2026-11-17T12:00:00.000Z'),
    assignedUser: null,
    team: null,
    aiCampaign: null,
    connection: { label: 'Principal', provider: 'META' },
    ...overrides,
  }
}

export function createFakeWaDashboardEvent(
  overrides?: Partial<WaDashboardEvent>,
): WaDashboardEvent {
  return {
    id: createId(),
    kind: 'CLOSED',
    source: 'AGENT',
    reason: null,
    closeOutcome: null,
    closeStatusLabels: [],
    createdAt: new Date('2026-11-17T13:00:00.000Z'),
    actorUser: null,
    conversation: {
      assignedUser: null,
      team: null,
      aiCampaign: null,
      connection: { label: 'Principal' },
    },
    ...overrides,
  }
}

/** An open cycle: 15 min to answer (warn at 12), 60 min to resolve. */
export function createFakeWaDashboardSlaCycle(
  overrides?: Partial<WaDashboardSlaCycle>,
): WaDashboardSlaCycle {
  return {
    id: createId(),
    policyId: null,
    teamId: null,
    agentUserId: null,
    businessHoursOnly: false,
    firstResponseMinutes: 15,
    resolutionMinutes: 60,
    startedAt: new Date('2026-11-17T12:00:00.000Z'),
    firstResponseDueAt: new Date('2026-11-17T12:15:00.000Z'),
    firstResponseWarnAt: new Date('2026-11-17T12:12:00.000Z'),
    resolutionDueAt: new Date('2026-11-17T13:00:00.000Z'),
    resolutionWarnAt: new Date('2026-11-17T12:48:00.000Z'),
    firstResponseAt: null,
    firstResponseSeconds: null,
    resolvedAt: null,
    createdAt: new Date('2026-11-17T12:00:00.000Z'),
    conversation: {
      aiCampaign: null,
      connection: { label: 'Principal' },
    },
    ...overrides,
  }
}

export function createFakeWaDashboardTeamMember(
  overrides?: Partial<WaDashboardTeamMember>,
): WaDashboardTeamMember {
  return {
    id: createId(),
    teamId: createId(),
    userId: createId(),
    role: 'AGENT',
    createdAt: new Date('2026-10-01T12:00:00.000Z'),
    team: { name: 'Retenção' },
    user: { name: 'Ana' },
    ...overrides,
  }
}
