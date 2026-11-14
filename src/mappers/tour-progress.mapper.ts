import type { UserTourProgress } from '@prisma/client'
import type { TourProgressDTO } from '@/types/tour-progress'

export function toTourProgressDTO(row: UserTourProgress): TourProgressDTO {
  return {
    key: row.tourKey,
    version: row.version,
    status: row.status,
    seenAt: row.seenAt.toISOString(),
  }
}
