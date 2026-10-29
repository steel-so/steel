import type {
  Prisma,
  SteelAgentVersion,
  SteelAgentVersionStatus,
} from '@prisma/client'
import { steelAgentVersionNotFound } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type {
  VersionApprovalRow,
  VersionRunRow,
  VersionTool,
} from '@/src/lib/steel-agents/versions'
import { dbError } from './db-error'

export interface SteelAgentVersionCreateInput {
  workspaceId: string
  agentId: string
  status: SteelAgentVersionStatus
  instructions: string
  maxToolRounds: number
  tools: VersionTool[]
  changeNote?: string | null
  rolloutPercent?: number | null
  createdById?: string | null
}

export interface SteelAgentVersionUpdateInput {
  status?: SteelAgentVersionStatus
  evalRunId?: string | null
  evalPassed?: number | null
  evalTotal?: number | null
  evalNote?: string | null
  resolvedAt?: Date | null
}

/** Cap of rows read for the A/B comparison (newest first). */
const STATS_LIMIT = 20_000

/**
 * Immutable snapshots of a Steel Agent (A2). Pointer moves (publish,
 * challenger) happen in transactions so the agent never points at two
 * versions at once. No access rules here.
 */
export const SteelAgentVersionRepository = {
  /** Creates the next numbered version (number = max + 1, in a transaction). */
  async create(
    data: SteelAgentVersionCreateInput,
  ): Promise<Result<SteelAgentVersion>> {
    try {
      const version = await prisma.$transaction(async (tx) => {
        const last = await tx.steelAgentVersion.aggregate({
          where: { agentId: data.agentId },
          _max: { number: true },
        })
        const { tools, ...fields } = data
        return tx.steelAgentVersion.create({
          data: {
            ...fields,
            number: (last._max.number ?? 0) + 1,
            tools: tools as unknown as Prisma.InputJsonValue,
            ...(data.status === 'PUBLISHED' && { publishedAt: new Date() }),
          },
        })
      })
      return ok(version)
    } catch (error) {
      return err(dbError('Failed to create steel agent version', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<SteelAgentVersion>> {
    try {
      const version = await prisma.steelAgentVersion.findFirst({
        where: { id, workspaceId },
      })
      if (!version) return err(steelAgentVersionNotFound())
      return ok(version)
    } catch (error) {
      return err(dbError('Failed to find steel agent version', error))
    }
  },

  /** Unscoped lookup for the worker (runner overlay, eval runs). */
  async findByIdUnscoped(
    id: string,
  ): Promise<Result<SteelAgentVersion | null>> {
    try {
      return ok(await prisma.steelAgentVersion.findUnique({ where: { id } }))
    } catch (error) {
      return err(dbError('Failed to load steel agent version', error))
    }
  },

  async listByAgent(
    agentId: string,
    workspaceId: string,
  ): Promise<Result<SteelAgentVersion[]>> {
    try {
      return ok(
        await prisma.steelAgentVersion.findMany({
          where: { agentId, workspaceId },
          orderBy: { number: 'desc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list steel agent versions', error))
    }
  },

  async findPending(
    agentId: string,
  ): Promise<Result<SteelAgentVersion | null>> {
    try {
      return ok(
        await prisma.steelAgentVersion.findFirst({
          where: { agentId, status: 'PENDING_EVAL' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find pending steel agent version', error))
    }
  },

  async update(
    id: string,
    data: SteelAgentVersionUpdateInput,
  ): Promise<Result<SteelAgentVersion>> {
    try {
      return ok(await prisma.steelAgentVersion.update({ where: { id }, data }))
    } catch (error) {
      return err(dbError('Failed to update steel agent version', error))
    }
  },

  /**
   * Publishes `versionId`: the previous published version is superseded, the
   * agent's own columns (and tools) mirror the snapshot, and a challenger
   * pointer to this version is cleared.
   */
  async publish(
    version: SteelAgentVersion,
    tools: VersionTool[],
  ): Promise<Result<SteelAgentVersion>> {
    try {
      const now = new Date()
      const published = await prisma.$transaction(async (tx) => {
        await tx.steelAgentVersion.updateMany({
          where: {
            agentId: version.agentId,
            status: 'PUBLISHED',
            id: { not: version.id },
          },
          data: { status: 'SUPERSEDED', resolvedAt: now },
        })
        const row = await tx.steelAgentVersion.update({
          where: { id: version.id },
          data: {
            status: 'PUBLISHED',
            publishedAt: now,
            resolvedAt: null,
            rolloutPercent: null,
          },
        })
        await tx.steelAgentTool.deleteMany({
          where: { agentId: version.agentId },
        })
        if (tools.length > 0) {
          await tx.steelAgentTool.createMany({
            data: tools.map((tool) => ({ ...tool, agentId: version.agentId })),
          })
        }
        const agent = await tx.steelAgent.findUnique({
          where: { id: version.agentId },
          select: { challengerVersionId: true },
        })
        await tx.steelAgent.update({
          where: { id: version.agentId },
          data: {
            instructions: version.instructions,
            maxToolRounds: version.maxToolRounds,
            publishedVersionId: version.id,
            ...(agent?.challengerVersionId === version.id && {
              challengerVersionId: null,
            }),
          },
        })
        return row
      })
      return ok(published)
    } catch (error) {
      return err(dbError('Failed to publish steel agent version', error))
    }
  },

  /** Makes `versionId` the A/B challenger, discarding the previous one. */
  async makeChallenger(
    versionId: string,
    agentId: string,
    rolloutPercent: number,
  ): Promise<Result<SteelAgentVersion>> {
    try {
      const now = new Date()
      const row = await prisma.$transaction(async (tx) => {
        await tx.steelAgentVersion.updateMany({
          where: {
            agentId,
            status: 'CHALLENGER',
            id: { not: versionId },
          },
          data: { status: 'DISCARDED', resolvedAt: now },
        })
        const updated = await tx.steelAgentVersion.update({
          where: { id: versionId },
          data: {
            status: 'CHALLENGER',
            rolloutPercent,
            publishedAt: now,
            resolvedAt: null,
          },
        })
        await tx.steelAgent.update({
          where: { id: agentId },
          data: { challengerVersionId: versionId },
        })
        return updated
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to start steel agent experiment', error))
    }
  },

  /** Ends a version without publishing it; clears the challenger pointer. */
  async close(
    versionId: string,
    agentId: string,
    status: Extract<SteelAgentVersionStatus, 'DISCARDED' | 'REJECTED'>,
    extra: Pick<SteelAgentVersionUpdateInput, 'evalNote'> = {},
  ): Promise<Result<SteelAgentVersion>> {
    try {
      const row = await prisma.$transaction(async (tx) => {
        const updated = await tx.steelAgentVersion.update({
          where: { id: versionId },
          data: { status, resolvedAt: new Date(), ...extra },
        })
        await tx.steelAgent.updateMany({
          where: { id: agentId, challengerVersionId: versionId },
          data: { challengerVersionId: null },
        })
        return updated
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to close steel agent version', error))
    }
  },

  /** Moves the agent's published pointer without touching its columns. */
  async setPublishedPointer(
    agentId: string,
    versionId: string,
  ): Promise<Result<true>> {
    try {
      await prisma.steelAgent.update({
        where: { id: agentId },
        data: { publishedVersionId: versionId },
      })
      return ok(true)
    } catch (error) {
      return err(dbError('Failed to set published version', error))
    }
  },

  /** Rows behind the A/B comparison (real runs only, never tests). */
  async statsRows(
    agentId: string,
  ): Promise<
    Result<{ runs: VersionRunRow[]; approvals: VersionApprovalRow[] }>
  > {
    try {
      const [runs, approvals] = await Promise.all([
        prisma.steelAgentRun.findMany({
          where: { agentId, isTest: false, versionId: { not: null } },
          select: {
            versionId: true,
            status: true,
            costUsd: true,
            rounds: true,
          },
          orderBy: { createdAt: 'desc' },
          take: STATS_LIMIT,
        }),
        prisma.aiPendingAction.findMany({
          where: {
            agentRun: { agentId, isTest: false, versionId: { not: null } },
          },
          select: { status: true, agentRun: { select: { versionId: true } } },
          orderBy: { createdAt: 'desc' },
          take: STATS_LIMIT,
        }),
      ])
      return ok({
        runs: runs.map((run) => ({
          versionId: run.versionId as string,
          status: run.status,
          costUsd: Number(run.costUsd),
          rounds: run.rounds,
        })),
        approvals: approvals.flatMap((action) =>
          action.agentRun?.versionId
            ? [{ versionId: action.agentRun.versionId, status: action.status }]
            : [],
        ),
      })
    } catch (error) {
      return err(dbError('Failed to load steel agent version stats', error))
    }
  },
}
