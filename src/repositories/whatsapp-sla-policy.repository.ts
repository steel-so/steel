import type { Prisma, WhatsAppSlaPolicy } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

const policyInclude = {
  team: { select: { id: true, name: true } },
} satisfies Prisma.WhatsAppSlaPolicyInclude

export type WhatsAppSlaPolicyWithTeam = Prisma.WhatsAppSlaPolicyGetPayload<{
  include: typeof policyInclude
}>

export const WhatsAppSlaPolicyRepository = {
  /** Default first, then team overrides by team name. */
  async listByWorkspace(
    workspaceId: string,
  ): Promise<Result<WhatsAppSlaPolicyWithTeam[]>> {
    try {
      const rows = await prisma.whatsAppSlaPolicy.findMany({
        where: { workspaceId },
        include: policyInclude,
      })
      return ok(
        rows.sort((a, b) =>
          (a.team?.name ?? '').localeCompare(b.team?.name ?? ''),
        ),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp sla policies', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppSlaPolicyWithTeam | null>> {
    try {
      const row = await prisma.whatsAppSlaPolicy.findFirst({
        where: { id, workspaceId },
        include: policyInclude,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find whatsapp sla policy', error))
    }
  },

  /** The policy of exactly this scope: `teamId` null = the default. */
  async findByScope(
    workspaceId: string,
    teamId: string | null,
  ): Promise<Result<WhatsAppSlaPolicy | null>> {
    try {
      const row = await prisma.whatsAppSlaPolicy.findFirst({
        where: { workspaceId, teamId },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find whatsapp sla policy by scope', error))
    }
  },

  /** Team override when the team has one, otherwise the default. */
  async resolveForTeam(
    workspaceId: string,
    teamId: string | null,
  ): Promise<Result<WhatsAppSlaPolicy | null>> {
    try {
      const rows = await prisma.whatsAppSlaPolicy.findMany({
        where: {
          workspaceId,
          OR: teamId ? [{ teamId }, { teamId: null }] : [{ teamId: null }],
        },
      })
      const override = teamId ? rows.find((row) => row.teamId === teamId) : null
      return ok(override ?? rows.find((row) => row.teamId === null) ?? null)
    } catch (error) {
      return err(dbError('Failed to resolve whatsapp sla policy', error))
    }
  },

  async create(
    data: Prisma.WhatsAppSlaPolicyUncheckedCreateInput,
  ): Promise<Result<WhatsAppSlaPolicyWithTeam>> {
    try {
      const row = await prisma.whatsAppSlaPolicy.create({
        data,
        include: policyInclude,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to create whatsapp sla policy', error))
    }
  },

  async update(
    id: string,
    data: Prisma.WhatsAppSlaPolicyUncheckedUpdateInput,
  ): Promise<Result<WhatsAppSlaPolicyWithTeam>> {
    try {
      const row = await prisma.whatsAppSlaPolicy.update({
        where: { id },
        data,
        include: policyInclude,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to update whatsapp sla policy', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.whatsAppSlaPolicy.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete whatsapp sla policy', error))
    }
  },
}
