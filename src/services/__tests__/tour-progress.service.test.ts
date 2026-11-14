import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeTourProgress } from '@/src/__tests__/factories/tour-progress.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { TourProgressService } from '../tour-progress.service'

vi.mock('@/src/repositories/tour-progress.repository')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { TourProgressRepository } from '@/src/repositories/tour-progress.repository'

const repo = vi.mocked(TourProgressRepository)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TourProgressService', () => {
  describe('list()', () => {
    it('should return the tours seen by the actor as DTOs', async () => {
      repo.listByUser.mockResolvedValue(
        ok([
          createFakeTourProgress(),
          createFakeTourProgress({
            id: 'tour_progress_456',
            tourKey: 'crm.leads',
            version: 2,
            status: 'SKIPPED',
          }),
        ]),
      )

      const items = expectOk(await TourProgressService.list('user_123'))

      expect(repo.listByUser).toHaveBeenCalledWith('user_123')
      expect(items).toEqual([
        {
          key: 'platform.home',
          version: 1,
          status: 'COMPLETED',
          seenAt: '2026-11-13T12:00:00.000Z',
        },
        {
          key: 'crm.leads',
          version: 2,
          status: 'SKIPPED',
          seenAt: '2026-11-13T12:00:00.000Z',
        },
      ])
    })

    it('should return an empty list for a user who saw nothing', async () => {
      repo.listByUser.mockResolvedValue(ok([]))

      expect(expectOk(await TourProgressService.list('user_123'))).toEqual([])
    })

    it('should propagate a database error', async () => {
      repo.listByUser.mockResolvedValue(err(databaseError('boom')))

      const error = expectErr(await TourProgressService.list('user_123'))

      expect(error.code).toBe('DATABASE_ERROR')
    })
  })

  describe('markSeen()', () => {
    const dto = {
      key: 'platform.home',
      version: 1,
      status: 'COMPLETED',
    } as const

    it('should save the record for the actor and return the DTO', async () => {
      repo.upsert.mockResolvedValue(ok(createFakeTourProgress()))

      const saved = expectOk(
        await TourProgressService.markSeen('user_123', dto),
      )

      expect(repo.upsert).toHaveBeenCalledWith('user_123', dto)
      expect(saved).toEqual({
        key: 'platform.home',
        version: 1,
        status: 'COMPLETED',
        seenAt: '2026-11-13T12:00:00.000Z',
      })
      expect(logger.info).toHaveBeenCalledWith(
        'tour.seen',
        expect.objectContaining({
          actorId: 'user_123',
          tourKey: 'platform.home',
          status: 'COMPLETED',
        }),
      )
    })

    it('should propagate a database error without logging', async () => {
      repo.upsert.mockResolvedValue(err(databaseError('boom')))

      const error = expectErr(
        await TourProgressService.markSeen('user_123', dto),
      )

      expect(error.code).toBe('DATABASE_ERROR')
      expect(logger.info).not.toHaveBeenCalled()
    })
  })
})
