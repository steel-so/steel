import type { Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Bulk reads for the attendance and team sources of the Comunicação
 * (WhatsApp) dashboards. Prisma only: the window and ceilings come from the
 * service, and the flattening and derivation live in the mapper. Only the
 * attendances query selects the contact (name and number); no query selects
 * the text of a message.
 */

const NAME = { select: { name: true } } as const

/** `IN (...)` lists are chunked to stay far from the bind-parameter limit. */
const IN_CHUNK = 5_000

/** Only the zap conversations: the ServiceDesk connections stay out. */
const ZAP_ONLY = {
  connection: { module: 'COMMUNICATION' },
} as const satisfies Prisma.WhatsAppConversationWhereInput

export const WA_DASHBOARD_ATTENDANCE_SELECT = {
  id: true,
  status: true,
  assignedUserId: true,
  aiActive: true,
  aiHandoff: true,
  unreadCount: true,
  avgSentimentScore: true,
  lastMessageAt: true,
  lastInboundAt: true,
  archivedAt: true,
  closedAt: true,
  closeReason: true,
  closeOutcome: true,
  closeStatusLabels: true,
  firstInboundAt: true,
  firstResponseAt: true,
  createdAt: true,
  assignedUser: NAME,
  team: NAME,
  aiCampaign: NAME,
  connection: { select: { label: true, provider: true } },
  // Only the attendances source carries the contact's name and number (the
  // TV link strips them): the table of who is waiting needs to name them.
  contact: { select: { name: true, waId: true } },
} as const satisfies Prisma.WhatsAppConversationSelect

export type WaDashboardAttendance = Prisma.WhatsAppConversationGetPayload<{
  select: typeof WA_DASHBOARD_ATTENDANCE_SELECT
}>

export const WA_DASHBOARD_EVENT_SELECT = {
  id: true,
  kind: true,
  source: true,
  reason: true,
  closeOutcome: true,
  closeStatusLabels: true,
  createdAt: true,
  actorUser: NAME,
  conversation: {
    select: {
      assignedUser: NAME,
      team: NAME,
      aiCampaign: NAME,
      connection: { select: { label: true } },
    },
  },
} as const satisfies Prisma.WhatsAppConversationEventSelect

export type WaDashboardEvent = Prisma.WhatsAppConversationEventGetPayload<{
  select: typeof WA_DASHBOARD_EVENT_SELECT
}>

export const WA_DASHBOARD_SLA_CYCLE_SELECT = {
  id: true,
  policyId: true,
  teamId: true,
  agentUserId: true,
  businessHoursOnly: true,
  firstResponseMinutes: true,
  resolutionMinutes: true,
  startedAt: true,
  firstResponseDueAt: true,
  firstResponseWarnAt: true,
  resolutionDueAt: true,
  resolutionWarnAt: true,
  firstResponseAt: true,
  firstResponseSeconds: true,
  resolvedAt: true,
  createdAt: true,
  conversation: {
    select: {
      aiCampaign: NAME,
      connection: { select: { label: true } },
    },
  },
} as const satisfies Prisma.WhatsAppSlaCycleSelect

export type WaDashboardSlaCycle = Prisma.WhatsAppSlaCycleGetPayload<{
  select: typeof WA_DASHBOARD_SLA_CYCLE_SELECT
}>

export interface WaSlaCycleData {
  cycles: WaDashboardSlaCycle[]
  /** SLA policies of the workspace (`teamId` null = the default one). */
  policies: { id: string; teamId: string | null }[]
  /** Teams of the workspace (the cycle only stores the team id). */
  teams: { id: string; name: string }[]
  /** Users referenced by `agentUserId` of the cycles. */
  agents: { id: string; name: string }[]
}

export const WA_DASHBOARD_TEAM_MEMBER_SELECT = {
  id: true,
  teamId: true,
  userId: true,
  role: true,
  createdAt: true,
  team: NAME,
  user: NAME,
} as const satisfies Prisma.WhatsAppTeamMemberSelect

export type WaDashboardTeamMember = Prisma.WhatsAppTeamMemberGetPayload<{
  select: typeof WA_DASHBOARD_TEAM_MEMBER_SELECT
}>

export const WA_DASHBOARD_PRESENCE_SELECT = {
  userId: true,
  status: true,
  lastAssignedAt: true,
  updatedAt: true,
} as const satisfies Prisma.WhatsAppAgentPresenceSelect

export type WaDashboardPresence = Prisma.WhatsAppAgentPresenceGetPayload<{
  select: typeof WA_DASHBOARD_PRESENCE_SELECT
}>

/** Open conversations of a team assigned to one attendant. */
export interface WaDashboardOpenCount {
  teamId: string | null
  userId: string | null
  count: number
}

export interface WaTeamMemberData {
  members: WaDashboardTeamMember[]
  presences: WaDashboardPresence[]
  openCounts: WaDashboardOpenCount[]
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

export const WhatsAppDashboardAttendanceRepository = {
  /**
   * Conversations of the zap (not deleted) that were created or had a
   * message since `since`, plus every one still open, most recent activity
   * first, up to `limit`.
   */
  async attendances(
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<
    Result<(WaDashboardAttendance & { avgResponseSeconds: number | null })[]>
  > {
    try {
      const rows = await prisma.whatsAppConversation.findMany({
        where: {
          workspaceId,
          ...ZAP_ONLY,
          deletedAt: null,
          OR: [
            { createdAt: { gte: since } },
            { lastMessageAt: { gte: since } },
            { status: { not: 'CLOSED' } },
          ],
        },
        select: WA_DASHBOARD_ATTENDANCE_SELECT,
        orderBy: [
          { lastMessageAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        take: limit,
      })
      const averages = new Map<string, number>()
      for (const ids of chunks(
        rows.map((row) => row.id),
        IN_CHUNK,
      )) {
        const found = await prisma.$queryRaw<
          { conversation_id: string; avg_seconds: number | null }[]
        >`
          WITH ev AS (
            SELECT conversation_id, created_at, direction,
              LAG(direction) OVER w AS prev,
              MIN(created_at) FILTER (WHERE direction = 'OUT') OVER (
                PARTITION BY conversation_id ORDER BY created_at
                ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING
              ) AS next_out
            FROM whatsapp_messages
            WHERE conversation_id = ANY(${ids})
              AND deleted_at IS NULL
              AND (direction = 'IN'
                OR (direction = 'OUT' AND sender_user_id IS NOT NULL
                  AND sent_by_ai = false))
            WINDOW w AS (PARTITION BY conversation_id ORDER BY created_at)
          )
          SELECT conversation_id,
            AVG(EXTRACT(EPOCH FROM (next_out - created_at)))::float8 AS avg_seconds
          FROM ev
          WHERE direction = 'IN'
            AND (prev IS NULL OR prev = 'OUT')
            AND next_out IS NOT NULL
          GROUP BY conversation_id`
        for (const row of found) {
          if (row.avg_seconds !== null) {
            averages.set(row.conversation_id, row.avg_seconds)
          }
        }
      }
      return ok(
        rows.map((row) => ({
          ...row,
          avgResponseSeconds: averages.get(row.id) ?? null,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to load the attendances source', error))
    }
  },

  /**
   * Timeline events of the zap conversations (not deleted) since `since`,
   * newest first, up to `limit`.
   */
  async conversationEvents(
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<Result<WaDashboardEvent[]>> {
    try {
      const rows = await prisma.whatsAppConversationEvent.findMany({
        where: {
          workspaceId,
          createdAt: { gte: since },
          conversation: { ...ZAP_ONLY, deletedAt: null },
        },
        select: WA_DASHBOARD_EVENT_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      })
      return ok(rows)
    } catch (error) {
      return err(
        dbError('Failed to load the conversation events source', error),
      )
    }
  },

  /**
   * SLA cycles started since `since`, plus every one still open, newest
   * first, up to `limit`, with what names them: the policies and teams of
   * the workspace and the users the cycles point to (the cycle stores
   * plain ids, without relations).
   */
  async slaCycleData(
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<Result<WaSlaCycleData>> {
    try {
      const cycles = await prisma.whatsAppSlaCycle.findMany({
        where: {
          workspaceId,
          conversation: ZAP_ONLY,
          OR: [{ startedAt: { gte: since } }, { resolvedAt: null }],
        },
        select: WA_DASHBOARD_SLA_CYCLE_SELECT,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take: limit,
      })
      if (cycles.length === 0) {
        return ok({ cycles, policies: [], teams: [], agents: [] })
      }

      const agentIds = [
        ...new Set(
          cycles
            .map((cycle) => cycle.agentUserId)
            .filter((id): id is string => id !== null),
        ),
      ]
      const [policies, teams, agents] = await Promise.all([
        prisma.whatsAppSlaPolicy.findMany({
          where: { workspaceId },
          select: { id: true, teamId: true },
        }),
        prisma.whatsAppTeam.findMany({
          where: { workspaceId },
          select: { id: true, name: true },
        }),
        Promise.all(
          chunks(agentIds, IN_CHUNK).map((ids) =>
            prisma.user.findMany({
              where: { id: { in: ids } },
              select: { id: true, name: true },
            }),
          ),
        ),
      ])
      return ok({ cycles, policies, teams, agents: agents.flat() })
    } catch (error) {
      return err(dbError('Failed to load the SLA cycles source', error))
    }
  },

  /**
   * Current memberships of the teams of the workspace (by team name, then
   * by who joined first), up to `limit`, with the presence of each member
   * and how many open zap conversations each one holds per team.
   */
  async teamMemberData(
    workspaceId: string,
    limit: number,
  ): Promise<Result<WaTeamMemberData>> {
    try {
      const members = await prisma.whatsAppTeamMember.findMany({
        where: { team: { workspaceId } },
        select: WA_DASHBOARD_TEAM_MEMBER_SELECT,
        orderBy: [
          { team: { name: 'asc' } },
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
        take: limit,
      })
      if (members.length === 0) {
        return ok({ members, presences: [], openCounts: [] })
      }

      const userIds = [...new Set(members.map((member) => member.userId))]
      const [presences, counts] = await Promise.all([
        Promise.all(
          chunks(userIds, IN_CHUNK).map((ids) =>
            prisma.whatsAppAgentPresence.findMany({
              where: { workspaceId, userId: { in: ids } },
              select: WA_DASHBOARD_PRESENCE_SELECT,
            }),
          ),
        ),
        prisma.whatsAppConversation.groupBy({
          by: ['teamId', 'assignedUserId'],
          where: {
            workspaceId,
            ...ZAP_ONLY,
            deletedAt: null,
            status: { not: 'CLOSED' },
            teamId: { not: null },
            assignedUserId: { not: null },
          },
          _count: { _all: true },
        }),
      ])
      return ok({
        members,
        presences: presences.flat(),
        openCounts: counts.map((row) => ({
          teamId: row.teamId,
          userId: row.assignedUserId,
          count: row._count._all,
        })),
      })
    } catch (error) {
      return err(dbError('Failed to load the team members source', error))
    }
  },
}
