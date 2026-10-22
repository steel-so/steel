import {
  Prisma,
  type VoiceAgentRoute,
  type VoiceAgentRouteKind,
  type VoiceAgentSettings,
  type WhatsAppPhoneCall,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** A claimed AudioSocket session is only valid shortly after it was minted. */
export const VOICE_SESSION_CLAIM_WINDOW_MS = 2 * 60 * 1000

/** Tickets the status lookup considers for one caller. */
export const VOICE_CALLER_TICKET_LIMIT = 20

/**
 * DDD + last 8 digits of a phone column, `NULL` when it is not a 10/11
 * digit national number. Same rule as `phoneMatchKey` (ADR 0043), applied in
 * SQL because ServiceDesk contacts keep phones as free text.
 */
function phoneKeySql(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(
    SELECT left(n, 2) || right(n, 8)
    FROM (
      SELECT CASE
        WHEN d LIKE '55%' AND length(d) IN (12, 13) THEN substr(d, 3)
        ELSE d
      END AS n
      FROM (SELECT regexp_replace(coalesce(${column}, ''), '\\D', '', 'g') AS d) digits
    ) national
    WHERE length(n) IN (10, 11)
  )`
}

export interface VoiceUsageTotals {
  seconds: number
  calls: number
}

export const VoiceAgentRepository = {
  async findSettings(
    workspaceId: string,
  ): Promise<Result<VoiceAgentSettings | null>> {
    try {
      return ok(
        await prisma.voiceAgentSettings.findUnique({ where: { workspaceId } }),
      )
    } catch (error) {
      return err(dbError('Failed to read voice agent settings', error))
    }
  },

  async upsertSettings(
    workspaceId: string,
    data: Omit<Prisma.VoiceAgentSettingsUncheckedUpdateInput, 'workspaceId'>,
  ): Promise<Result<VoiceAgentSettings>> {
    try {
      return ok(
        await prisma.voiceAgentSettings.upsert({
          where: { workspaceId },
          create: {
            ...(data as Prisma.VoiceAgentSettingsUncheckedCreateInput),
            workspaceId,
          },
          update: data,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to save voice agent settings', error))
    }
  },

  async listRoutes(workspaceId: string): Promise<Result<VoiceAgentRoute[]>> {
    try {
      return ok(
        await prisma.voiceAgentRoute.findMany({
          where: { workspaceId },
          orderBy: [{ kind: 'asc' }, { value: 'asc' }],
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list voice agent routes', error))
    }
  },

  async findRoute(
    id: string,
    workspaceId: string,
  ): Promise<Result<VoiceAgentRoute | null>> {
    try {
      return ok(
        await prisma.voiceAgentRoute.findFirst({ where: { id, workspaceId } }),
      )
    } catch (error) {
      return err(dbError('Failed to read voice agent route', error))
    }
  },

  /** Enabled routes matching the queue or the dialed number of a call. */
  async findEnabledRoute(
    workspaceId: string,
    match: { queue?: string; did?: string },
  ): Promise<Result<VoiceAgentRoute | null>> {
    const options: Prisma.VoiceAgentRouteWhereInput[] = []
    if (match.queue) options.push({ kind: 'QUEUE', value: match.queue })
    if (match.did) options.push({ kind: 'DID', value: match.did })
    if (options.length === 0) return ok(null)
    try {
      return ok(
        await prisma.voiceAgentRoute.findFirst({
          where: { workspaceId, enabled: true, OR: options },
          // A DID is more specific than a queue.
          orderBy: { kind: 'desc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to match a voice agent route', error))
    }
  },

  async createRoute(data: {
    workspaceId: string
    kind: VoiceAgentRouteKind
    value: string
    label?: string | null
    enabled?: boolean
    transferTarget?: string | null
  }): Promise<Result<VoiceAgentRoute>> {
    try {
      return ok(await prisma.voiceAgentRoute.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create voice agent route', error))
    }
  },

  async updateRoute(
    id: string,
    data: Prisma.VoiceAgentRouteUncheckedUpdateInput,
  ): Promise<Result<VoiceAgentRoute>> {
    try {
      return ok(await prisma.voiceAgentRoute.update({ where: { id }, data }))
    } catch (error) {
      return err(dbError('Failed to update voice agent route', error))
    }
  },

  async deleteRoute(id: string): Promise<Result<void>> {
    try {
      await prisma.voiceAgentRoute.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete voice agent route', error))
    }
  },

  /** Seconds and calls the attendant handled since `since`. */
  async usageSince(
    workspaceId: string,
    since: Date,
  ): Promise<Result<VoiceUsageTotals>> {
    try {
      const total = await prisma.whatsAppPhoneCall.aggregate({
        where: { workspaceId, voiceAgent: true, createdAt: { gte: since } },
        _sum: { durationSeconds: true },
        _count: { _all: true },
      })
      return ok({
        seconds: total._sum.durationSeconds ?? 0,
        calls: total._count._all,
      })
    } catch (error) {
      return err(dbError('Failed to sum voice agent usage', error))
    }
  },

  /**
   * One-shot claim of a freshly minted session: `QUEUED` voice call whose
   * token hash matches, younger than the claim window. The conditional
   * update makes a replayed UUID lose the race.
   */
  async claimSession(
    callbackTokenHash: string,
    now: Date,
  ): Promise<Result<WhatsAppPhoneCall | null>> {
    try {
      const claimed = await prisma.whatsAppPhoneCall.updateMany({
        where: {
          callbackTokenHash,
          voiceAgent: true,
          status: 'QUEUED',
          createdAt: {
            gte: new Date(now.getTime() - VOICE_SESSION_CLAIM_WINDOW_MS),
          },
        },
        data: { status: 'IN_PROGRESS', answeredAt: now },
      })
      if (claimed.count === 0) return ok(null)
      return ok(
        await prisma.whatsAppPhoneCall.findUnique({
          where: { callbackTokenHash },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to claim a voice agent session', error))
    }
  },

  /** Voice calls left `IN_PROGRESS` by a crashed worker (sweep on boot). */
  async failStaleSessions(olderThan: Date, now: Date): Promise<Result<number>> {
    try {
      const result = await prisma.whatsAppPhoneCall.updateMany({
        where: {
          voiceAgent: true,
          status: { in: ['QUEUED', 'IN_PROGRESS'] },
          createdAt: { lt: olderThan },
        },
        data: {
          status: 'FAILED',
          endedAt: now,
          voiceEndReason: 'worker_restart',
        },
      })
      return ok(result.count)
    } catch (error) {
      return err(dbError('Failed to close stale voice agent sessions', error))
    }
  },

  /**
   * Tickets that belong to a caller, by phone: tickets of a ServiceDesk
   * contact with that phone/WhatsApp and tickets attached to an earlier call
   * from that number. Anything else is never visible to the caller.
   */
  async findTicketIdsForCaller(
    workspaceId: string,
    phoneKey: string,
  ): Promise<Result<{ id: string; number: number }[]>> {
    try {
      const rows = await prisma.$queryRaw<{ id: string; number: number }[]>(
        Prisma.sql`
          SELECT t.id, t.number
          FROM sd_tickets t
          WHERE t.workspace_id = ${workspaceId}
            AND t.deleted_at IS NULL
            AND (
              t.contact_id IN (
                SELECT c.id
                FROM sd_contacts c
                WHERE c.workspace_id = ${workspaceId}
                  AND c.deleted_at IS NULL
                  AND (
                    ${phoneKeySql(Prisma.sql`c.phone`)} = ${phoneKey}
                    OR ${phoneKeySql(Prisma.sql`c.whatsapp`)} = ${phoneKey}
                  )
              )
              OR t.id IN (
                SELECT p.sd_ticket_id
                FROM whatsapp_phone_calls p
                WHERE p.workspace_id = ${workspaceId}
                  AND p.sd_ticket_id IS NOT NULL
                  AND ${phoneKeySql(Prisma.sql`p.destination`)} = ${phoneKey}
              )
            )
          ORDER BY t.created_at DESC
          LIMIT ${VOICE_CALLER_TICKET_LIMIT}
        `,
      )
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to find the tickets of a caller', error))
    }
  },
}
