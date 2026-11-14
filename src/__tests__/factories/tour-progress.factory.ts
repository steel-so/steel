import type { UserTourProgress } from '@prisma/client'

export function createFakeTourProgress(
  overrides: Partial<UserTourProgress> = {},
): UserTourProgress {
  const now = new Date('2026-11-13T12:00:00.000Z')
  return {
    id: 'tour_progress_123',
    userId: 'user_123',
    tourKey: 'platform.home',
    version: 1,
    status: 'COMPLETED',
    seenAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
