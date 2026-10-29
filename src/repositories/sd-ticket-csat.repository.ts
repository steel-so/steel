import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const SdTicketCsatRepository = {
  /**
   * Grava a avaliação só se o chamado ainda não tiver uma (condição atômica
   * no `WHERE`: duas respostas simultâneas não se sobrescrevem). `true` =
   * gravou; `false` = já havia avaliação (ou o chamado sumiu).
   */
  async submit(
    ticketId: string,
    workspaceId: string,
    score: number,
    comment: string | null,
  ): Promise<Result<boolean>> {
    try {
      const result = await prisma.sdTicket.updateMany({
        where: { id: ticketId, workspaceId, deletedAt: null, csatScore: null },
        data: { csatScore: score, csatComment: comment },
      })
      return ok(result.count === 1)
    } catch (error) {
      return err(dbError('Failed to submit SD ticket CSAT', error))
    }
  },

  /** Score already recorded on the ticket (portal or survey), if any. */
  async findScore(
    ticketId: string,
    workspaceId: string,
  ): Promise<Result<number | null>> {
    try {
      const ticket = await prisma.sdTicket.findFirst({
        where: { id: ticketId, workspaceId, deletedAt: null },
        select: { csatScore: true },
      })
      return ok(ticket?.csatScore ?? null)
    } catch (error) {
      return err(dbError('Failed to read SD ticket CSAT', error))
    }
  },

  /** Adds the comment to a rated ticket that has none (survey follow-up). */
  async setComment(
    ticketId: string,
    workspaceId: string,
    comment: string,
  ): Promise<Result<boolean>> {
    try {
      const result = await prisma.sdTicket.updateMany({
        where: {
          id: ticketId,
          workspaceId,
          deletedAt: null,
          csatScore: { not: null },
          csatComment: null,
        },
        data: { csatComment: comment },
      })
      return ok(result.count === 1)
    } catch (error) {
      return err(dbError('Failed to save SD ticket CSAT comment', error))
    }
  },
}
