import type { ModuleKind, SdTicketType } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'
import { SD_CLOSED_PHASE_CATEGORIES } from './sd-ticket.repository'

/**
 * Read-only queries behind the proactive AI (ADR 0040): which workspaces
 * and members to evaluate, and the raw signals of each module. No rule
 * here — thresholds and wording live in `src/lib/ai/proactive/rules.ts`.
 */

export interface ProactiveWorkspaceRow {
  id: string
  slug: string
  name: string
  /** `WorkspaceAiSettings.aiEnabled` (no row = on). */
  aiEnabled: boolean
  /** `WorkspaceAiSettings.proactiveEnabled` (no row = on). */
  proactiveEnabled: boolean
  /** Modules enabled for the workspace. */
  modules: ModuleKind[]
}

export interface ProactiveMemberRow {
  userId: string
  name: string
  email: string
  /** `UserPreference.timezone`, when the user has preferences. */
  timeZone: string | null
}

export interface SdBreachRow {
  ticketId: string
  number: number
  type: SdTicketType
  title: string
  departmentId: string | null
  departmentName: string | null
  assigneeId: string | null
  breachEtaAt: Date
  score: number
}

export interface ZapConversationRow {
  id: string
  assignedUserId: string | null
  teamId: string | null
  avgSentimentScore: number | null
  lastMessageAt: Date | null
  createdAt: Date
  contactName: string | null
}

/** Signals per tick are capped: an insight needs the worst, not all. */
const MAX_SIGNALS = 500

const ZAP_OPEN = {
  connection: { module: 'COMMUNICATION' as const },
  status: { in: ['NEW' as const, 'IN_PROGRESS' as const] },
  archivedAt: null,
  deletedAt: null,
}

const ZAP_SELECT = {
  id: true,
  assignedUserId: true,
  teamId: true,
  avgSentimentScore: true,
  lastMessageAt: true,
  createdAt: true,
  contact: { select: { name: true } },
} as const

type ZapSelected = {
  id: string
  assignedUserId: string | null
  teamId: string | null
  avgSentimentScore: number | null
  lastMessageAt: Date | null
  createdAt: Date
  contact: { name: string | null }
}

function toZapRow(row: ZapSelected): ZapConversationRow {
  return {
    id: row.id,
    assignedUserId: row.assignedUserId,
    teamId: row.teamId,
    avgSentimentScore: row.avgSentimentScore,
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
    contactName: row.contact.name,
  }
}

export const AiProactiveSignalRepository = {
  /** Active workspaces, with their AI switches and enabled modules. */
  async listWorkspaces(): Promise<Result<ProactiveWorkspaceRow[]>> {
    try {
      const rows = await prisma.workspace.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          slug: true,
          name: true,
          aiSettings: { select: { aiEnabled: true, proactiveEnabled: true } },
          moduleAccess: {
            where: { enabled: true },
            select: { module: true },
          },
        },
        orderBy: { id: 'asc' },
      })
      return ok(
        rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          name: row.name,
          aiEnabled: row.aiSettings?.aiEnabled ?? true,
          proactiveEnabled: row.aiSettings?.proactiveEnabled ?? true,
          modules: row.moduleAccess.map((access) => access.module),
        })),
      )
    } catch (error) {
      return err(
        dbError('Failed to list workspaces for the proactive AI', error),
      )
    }
  },

  /** Members of the workspace, minus accounts scheduled for deletion. */
  async listMembers(
    workspaceId: string,
  ): Promise<Result<ProactiveMemberRow[]>> {
    try {
      const rows = await prisma.membership.findMany({
        where: { workspaceId, user: { deletionScheduledAt: null } },
        select: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              preference: { select: { timezone: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      })
      return ok(
        rows.map(({ user }) => ({
          userId: user.id,
          name: user.name,
          email: user.email,
          timeZone: user.preference?.timezone ?? null,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to list members for the proactive AI', error))
    }
  },

  /**
   * Open tickets whose predicted breach (ADR 0016) falls in `[from, until]`,
   * soonest first.
   */
  async sdBreachForecast(
    workspaceId: string,
    from: Date,
    until: Date,
  ): Promise<Result<SdBreachRow[]>> {
    try {
      const rows = await prisma.sdTicketRiskPrediction.findMany({
        where: {
          workspaceId,
          breachEtaAt: { gte: from, lte: until },
          ticket: {
            deletedAt: null,
            phase: { category: { notIn: SD_CLOSED_PHASE_CATEGORIES } },
          },
        },
        select: {
          score: true,
          breachEtaAt: true,
          ticket: {
            select: {
              id: true,
              number: true,
              type: true,
              title: true,
              departmentId: true,
              assigneeId: true,
              department: { select: { name: true } },
            },
          },
        },
        orderBy: [{ breachEtaAt: 'asc' }, { score: 'desc' }],
        take: MAX_SIGNALS,
      })
      return ok(
        rows.map((row) => ({
          ticketId: row.ticket.id,
          number: row.ticket.number,
          type: row.ticket.type,
          title: row.ticket.title,
          departmentId: row.ticket.departmentId,
          departmentName: row.ticket.department?.name ?? null,
          assigneeId: row.ticket.assigneeId,
          // The `gte` filter makes it non-null.
          breachEtaAt: row.breachEtaAt as Date,
          score: row.score,
        })),
      )
    } catch (error) {
      return err(
        dbError('Failed to read the ServiceDesk breach forecast', error),
      )
    }
  },

  /**
   * Comunicação queue (same rule as `listWaiting`: open, not archived, no
   * assignee) waiting since `before` or earlier — last message, else
   * creation. Oldest first.
   */
  async zapWaiting(
    workspaceId: string,
    before: Date,
  ): Promise<Result<ZapConversationRow[]>> {
    try {
      const rows = await prisma.whatsAppConversation.findMany({
        where: {
          workspaceId,
          ...ZAP_OPEN,
          assignedUserId: null,
          OR: [
            { lastMessageAt: { lte: before } },
            { lastMessageAt: null, createdAt: { lte: before } },
          ],
        },
        select: ZAP_SELECT,
        orderBy: [{ lastMessageAt: 'asc' }, { createdAt: 'asc' }],
        take: MAX_SIGNALS,
      })
      return ok(rows.map(toZapRow))
    } catch (error) {
      return err(dbError('Failed to read waiting conversations', error))
    }
  },

  /**
   * Open conversations whose average sentiment is at or below `threshold`
   * with a message since `since`. Worst first.
   */
  async zapNegative(
    workspaceId: string,
    threshold: number,
    since: Date,
  ): Promise<Result<ZapConversationRow[]>> {
    try {
      const rows = await prisma.whatsAppConversation.findMany({
        where: {
          workspaceId,
          ...ZAP_OPEN,
          avgSentimentScore: { lte: threshold },
          lastMessageAt: { gte: since },
        },
        select: ZAP_SELECT,
        orderBy: [{ avgSentimentScore: 'asc' }, { id: 'asc' }],
        take: MAX_SIGNALS,
      })
      return ok(rows.map(toZapRow))
    } catch (error) {
      return err(dbError('Failed to read negative conversations', error))
    }
  },

  /**
   * The workspace's negative-sentiment alert rule (WhatsApp settings): off
   * there means off here too. No row = the schema defaults.
   */
  async zapSentimentRule(
    workspaceId: string,
  ): Promise<Result<{ enabled: boolean; threshold: number }>> {
    try {
      const row = await prisma.whatsAppSettings.findUnique({
        where: { workspaceId },
        select: { sentimentAlertEnabled: true, sentimentAlertThreshold: true },
      })
      return ok({
        enabled: row?.sentimentAlertEnabled ?? true,
        threshold: row?.sentimentAlertThreshold ?? -0.3,
      })
    } catch (error) {
      return err(dbError('Failed to read the sentiment alert rule', error))
    }
  },
}
