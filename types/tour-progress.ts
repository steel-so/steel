export type TourProgressStatus = 'COMPLETED' | 'SKIPPED'

/** A guided tour the user has already seen. */
export interface TourProgressDTO {
  key: string
  /** Version of the tour the user saw; a higher one reopens it once. */
  version: number
  status: TourProgressStatus
  seenAt: string
}
