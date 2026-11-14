import { logger } from '@/lib/axiom/logger'
import type { TourProgressDTO } from '@/types/tour-progress'
import { ok, type Result } from '../lib/result'
import { toTourProgressDTO } from '../mappers/tour-progress.mapper'
import { TourProgressRepository } from '../repositories/tour-progress.repository'
import type { MarkTourSeenDTO } from '../schemas/tour-progress.schema'

/**
 * Which guided tours the user has already seen. Always scoped to the actor:
 * there is no way to read or write another user's progress.
 */
export const TourProgressService = {
  async list(actorId: string): Promise<Result<TourProgressDTO[]>> {
    const rows = await TourProgressRepository.listByUser(actorId)
    if (!rows.ok) return rows
    return ok(rows.value.map(toTourProgressDTO))
  },

  async markSeen(
    actorId: string,
    dto: MarkTourSeenDTO,
  ): Promise<Result<TourProgressDTO>> {
    const row = await TourProgressRepository.upsert(actorId, dto)
    if (!row.ok) return row

    logger.info('tour.seen', {
      component: 'TourProgressService',
      actorId,
      tourKey: dto.key,
      version: dto.version,
      status: dto.status,
    })

    return ok(toTourProgressDTO(row.value))
  },
}
