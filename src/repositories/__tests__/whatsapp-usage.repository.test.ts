import { describe, expect, it, vi } from 'vitest'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppUsageRepository } from '../whatsapp-usage.repository'

describe('WhatsAppUsageRepository', () => {
  describe('find()', () => {
    it('should return null when the month has no usage', async () => {
      const workspace = await seedWorkspace()
      expect(
        expectOk(await WhatsAppUsageRepository.find(workspace.id, '2026-10')),
      ).toBeNull()
    })

    it('should return DATABASE_ERROR when the query throws', async () => {
      vi.spyOn(prisma.whatsAppUsageMonthly, 'findUnique').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await WhatsAppUsageRepository.find('w', '2026-10'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('increment()', () => {
    it('should create the month row and count each metric separately', async () => {
      const workspace = await seedWorkspace()

      const first = expectOk(
        await WhatsAppUsageRepository.increment(
          workspace.id,
          '2026-10',
          'messages',
        ),
      )
      expect(first.outboundMessages).toBe(1)
      expect(first.conversations).toBe(0)

      expectOk(
        await WhatsAppUsageRepository.increment(
          workspace.id,
          '2026-10',
          'messages',
        ),
      )
      const third = expectOk(
        await WhatsAppUsageRepository.increment(
          workspace.id,
          '2026-10',
          'conversations',
        ),
      )
      expect(third.id).toBe(first.id)
      expect(third.outboundMessages).toBe(2)
      expect(third.conversations).toBe(1)
    })

    it('should keep each month apart', async () => {
      const workspace = await seedWorkspace()
      expectOk(
        await WhatsAppUsageRepository.increment(
          workspace.id,
          '2026-10',
          'messages',
        ),
      )
      const next = expectOk(
        await WhatsAppUsageRepository.increment(
          workspace.id,
          '2026-11',
          'messages',
        ),
      )
      expect(next.outboundMessages).toBe(1)
    })

    it('should count concurrent increments without losing any', async () => {
      const workspace = await seedWorkspace()
      await Promise.all(
        Array.from({ length: 10 }, () =>
          WhatsAppUsageRepository.increment(
            workspace.id,
            '2026-10',
            'messages',
          ),
        ),
      )
      const row = expectOk(
        await WhatsAppUsageRepository.find(workspace.id, '2026-10'),
      )
      expect(row?.outboundMessages).toBe(10)
    })

    it('should return DATABASE_ERROR when the workspace does not exist', async () => {
      expectErr(
        await WhatsAppUsageRepository.increment(
          'missing-workspace',
          '2026-10',
          'messages',
        ),
        'DATABASE_ERROR',
      )
    })
  })
})
