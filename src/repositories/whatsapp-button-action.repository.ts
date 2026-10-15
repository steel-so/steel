import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export interface WhatsAppButtonActionTeam {
  id: string
  name: string
  memberIds: string[]
}

/**
 * Reads the click actions need outside the teams slice's own repository
 * (`ASSIGN_TEAM`): the team, scoped to the workspace, with its members.
 */
export const WhatsAppButtonActionRepository = {
  async findTeam(
    workspaceId: string,
    teamId: string,
  ): Promise<Result<WhatsAppButtonActionTeam | null>> {
    try {
      const team = await prisma.whatsAppTeam.findFirst({
        where: { id: teamId, workspaceId },
        select: {
          id: true,
          name: true,
          members: { select: { userId: true } },
        },
      })
      return ok(
        team
          ? {
              id: team.id,
              name: team.name,
              memberIds: team.members.map((member) => member.userId),
            }
          : null,
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp team', error))
    }
  },
}
