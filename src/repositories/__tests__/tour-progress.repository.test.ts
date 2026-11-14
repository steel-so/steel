import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { TourProgressRepository } from '../tour-progress.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

async function seedUser(id = 'user_tour_test') {
  return prisma.user.create({
    data: {
      id,
      name: 'Tour User',
      email: `${id}@example.com`,
      username: id,
    },
  })
}

describe('TourProgressRepository', () => {
  describe('listByUser()', () => {
    it('should return an empty list when the user saw no tour', async () => {
      const user = await seedUser()

      const rows = expectOk(await TourProgressRepository.listByUser(user.id))

      expect(rows).toEqual([])
    })

    it('should return only the rows of that user, ordered by key', async () => {
      const user = await seedUser()
      const other = await seedUser('user_tour_other')
      await TourProgressRepository.upsert(user.id, {
        key: 'platform.home',
        version: 1,
        status: 'COMPLETED',
      })
      await TourProgressRepository.upsert(user.id, {
        key: 'crm.leads',
        version: 1,
        status: 'SKIPPED',
      })
      await TourProgressRepository.upsert(other.id, {
        key: 'zap.conversations',
        version: 1,
        status: 'COMPLETED',
      })

      const rows = expectOk(await TourProgressRepository.listByUser(user.id))

      expect(rows.map((row) => row.tourKey)).toEqual([
        'crm.leads',
        'platform.home',
      ])
    })

    it('should return DATABASE_ERROR when the query throws', async () => {
      vi.spyOn(prisma.userTourProgress, 'findMany').mockRejectedValueOnce(
        new Error('connection lost'),
      )

      const result = await TourProgressRepository.listByUser('user_x')

      expect(expectErr(result).code).toBe('DATABASE_ERROR')
    })
  })

  describe('upsert()', () => {
    it('should create the row on the first time', async () => {
      const user = await seedUser()

      const row = expectOk(
        await TourProgressRepository.upsert(user.id, {
          key: 'platform.home',
          version: 1,
          status: 'SKIPPED',
        }),
      )

      expect(row.userId).toBe(user.id)
      expect(row.tourKey).toBe('platform.home')
      expect(row.version).toBe(1)
      expect(row.status).toBe('SKIPPED')
      expect(row.seenAt).toBeInstanceOf(Date)
    })

    it('should overwrite the row of the same tour instead of duplicating', async () => {
      const user = await seedUser()
      const first = expectOk(
        await TourProgressRepository.upsert(user.id, {
          key: 'platform.home',
          version: 1,
          status: 'SKIPPED',
        }),
      )

      const second = expectOk(
        await TourProgressRepository.upsert(user.id, {
          key: 'platform.home',
          version: 2,
          status: 'COMPLETED',
        }),
      )

      expect(second.id).toBe(first.id)
      expect(second.version).toBe(2)
      expect(second.status).toBe('COMPLETED')
      expect(
        await prisma.userTourProgress.count({ where: { userId: user.id } }),
      ).toBe(1)
    })

    it('should delete the rows with the user', async () => {
      const user = await seedUser()
      await TourProgressRepository.upsert(user.id, {
        key: 'platform.home',
        version: 1,
        status: 'COMPLETED',
      })

      await prisma.user.delete({ where: { id: user.id } })

      expect(await prisma.userTourProgress.count()).toBe(0)
    })

    it('should return DATABASE_ERROR when the write throws', async () => {
      vi.spyOn(prisma.userTourProgress, 'upsert').mockRejectedValueOnce(
        new Error('connection lost'),
      )

      const result = await TourProgressRepository.upsert('user_x', {
        key: 'platform.home',
        version: 1,
        status: 'COMPLETED',
      })

      expect(expectErr(result).code).toBe('DATABASE_ERROR')
    })
  })
})
