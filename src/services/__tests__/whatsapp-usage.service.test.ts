import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppSettings } from '@/src/__tests__/factories/whatsapp-settings.factory'
import { createFakeWhatsAppUsage } from '@/src/__tests__/factories/whatsapp-usage.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-settings.repository')
vi.mock('@/src/repositories/whatsapp-usage.repository')
vi.mock('@/src/services/platform-notifications', () => ({
  notifyWhatsAppUsage: vi.fn(async () => 1),
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { databaseError } from '@/src/errors'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import { WhatsAppUsageRepository } from '@/src/repositories/whatsapp-usage.repository'
import { notifyWhatsAppUsage } from '../platform-notifications'
import { WhatsAppUsageService } from '../whatsapp-usage.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedSettingsRepo = vi.mocked(WhatsAppSettingsRepository)
const mockedUsageRepo = vi.mocked(WhatsAppUsageRepository)
const mockedNotify = vi.mocked(notifyWhatsAppUsage)

function asRole(role: 'VIEWER' | 'MEMBER' | 'ADMIN' | 'OWNER') {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

function limits(conversations: number | null, messages: number | null) {
  mockedSettingsRepo.findByWorkspace.mockResolvedValue(
    ok(
      createFakeWhatsAppSettings({
        workspaceId: 'ws1',
        monthlyConversationLimit: conversations,
        monthlyMessageLimit: messages,
      }),
    ),
  )
}

function usage(conversations: number, outboundMessages: number) {
  mockedUsageRepo.find.mockResolvedValue(
    ok(
      createFakeWhatsAppUsage({
        workspaceId: 'ws1',
        conversations,
        outboundMessages,
      }),
    ),
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T12:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('WhatsAppUsageService', () => {
  describe('get()', () => {
    it('should show the current month usage to any member', async () => {
      asRole('MEMBER')
      limits(100, null)
      usage(50, 7)

      const dto = expectOk(await WhatsAppUsageService.get('u1', 'ws1'))

      expect(mockedUsageRepo.find).toHaveBeenCalledWith('ws1', '2026-10')
      expect(dto).toEqual(
        expect.objectContaining({
          period: '2026-10',
          canManage: false,
          conversations: { used: 50, limit: 100, percent: 50, reached: false },
          messages: { used: 7, limit: null, percent: null, reached: false },
        }),
      )
    })

    it('should flag canManage for an admin', async () => {
      asRole('ADMIN')
      limits(null, null)
      mockedUsageRepo.find.mockResolvedValue(ok(null))

      expect(
        expectOk(await WhatsAppUsageService.get('u1', 'ws1')).canManage,
      ).toBe(true)
    })

    it('should forbid a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(await WhatsAppUsageService.get('u1', 'ws1'), 'FORBIDDEN')
    })

    it('should propagate a repository failure', async () => {
      asRole('MEMBER')
      limits(null, null)
      mockedUsageRepo.find.mockResolvedValue(err(databaseError('boom')))
      expectErr(await WhatsAppUsageService.get('u1', 'ws1'), 'DATABASE_ERROR')
    })
  })

  describe('updateLimits()', () => {
    it('should let an OWNER set both limits and audit it', async () => {
      asRole('OWNER')
      limits(null, null)
      usage(0, 0)
      mockedSettingsRepo.upsert.mockResolvedValue(
        ok(
          createFakeWhatsAppSettings({
            id: 's1',
            workspaceId: 'ws1',
            monthlyConversationLimit: 500,
            monthlyMessageLimit: 10000,
          }),
        ),
      )

      const dto = expectOk(
        await WhatsAppUsageService.updateLimits('u1', 'ws1', {
          monthlyConversationLimit: 500,
          monthlyMessageLimit: 10000,
        }),
      )

      expect(mockedSettingsRepo.upsert).toHaveBeenCalledWith('ws1', {
        monthlyConversationLimit: 500,
        monthlyMessageLimit: 10000,
      })
      expect(dto.conversations.limit).toBe(500)
      expect(dto.messages.limit).toBe(10000)
      expect(auditMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'whatsapp_usage_limits',
          action: 'update',
          actorId: 'u1',
          meta: expect.objectContaining({
            workspaceId: 'ws1',
            monthlyConversationLimit: 500,
            monthlyMessageLimit: 10000,
          }),
        }),
      )
    })

    it('should only touch the fields sent (null clears to unlimited)', async () => {
      asRole('ADMIN')
      limits(500, 10000)
      usage(0, 0)
      mockedSettingsRepo.upsert.mockResolvedValue(
        ok(createFakeWhatsAppSettings({ monthlyMessageLimit: null })),
      )

      expectOk(
        await WhatsAppUsageService.updateLimits('u1', 'ws1', {
          monthlyMessageLimit: null,
        }),
      )
      expect(mockedSettingsRepo.upsert).toHaveBeenCalledWith('ws1', {
        monthlyMessageLimit: null,
      })
    })

    it('should forbid a MEMBER', async () => {
      asRole('MEMBER')
      expectErr(
        await WhatsAppUsageService.updateLimits('u1', 'ws1', {
          monthlyMessageLimit: 10,
        }),
        'FORBIDDEN',
      )
      expect(mockedSettingsRepo.upsert).not.toHaveBeenCalled()
    })

    it('should propagate a save failure', async () => {
      asRole('OWNER')
      mockedSettingsRepo.upsert.mockResolvedValue(err(databaseError('boom')))
      expectErr(
        await WhatsAppUsageService.updateLimits('u1', 'ws1', {
          monthlyMessageLimit: 10,
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('assertCanSend()', () => {
    it('should allow when there is no limit', async () => {
      limits(null, null)
      usage(9999, 9999)
      expectOk(await WhatsAppUsageService.assertCanSend('ws1', 'messages'))
      expectOk(await WhatsAppUsageService.assertCanSend('ws1', 'conversations'))
    })

    it('should allow below the limit', async () => {
      limits(10, 10)
      usage(9, 9)
      expectOk(await WhatsAppUsageService.assertCanSend('ws1', 'messages'))
    })

    it('should refuse messages at the limit with WHATSAPP_MESSAGE_LIMIT_REACHED', async () => {
      limits(null, 10)
      usage(0, 10)
      const error = expectErr(
        await WhatsAppUsageService.assertCanSend('ws1', 'messages'),
        'WHATSAPP_MESSAGE_LIMIT_REACHED',
      )
      expect(error.details).toEqual({ used: 10, limit: 10 })
    })

    it('should refuse new conversations at the limit with WHATSAPP_CONVERSATION_LIMIT_REACHED', async () => {
      limits(5, null)
      usage(5, 0)
      expectErr(
        await WhatsAppUsageService.assertCanSend('ws1', 'conversations'),
        'WHATSAPP_CONVERSATION_LIMIT_REACHED',
      )
    })

    it('should treat a month without usage as zero', async () => {
      limits(1, 1)
      mockedUsageRepo.find.mockResolvedValue(ok(null))
      expectOk(await WhatsAppUsageService.assertCanSend('ws1', 'messages'))
    })

    it('should fail open when the lookup fails (never blocks on a DB hiccup)', async () => {
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(
        err(databaseError('boom')),
      )
      expectOk(await WhatsAppUsageService.assertCanSend('ws1', 'messages'))

      limits(1, 1)
      mockedUsageRepo.find.mockResolvedValue(err(databaseError('boom')))
      expectOk(await WhatsAppUsageService.assertCanSend('ws1', 'messages'))
    })
  })

  describe('record()', () => {
    it('should increment the current month without notifying below 50%', async () => {
      limits(null, 100)
      mockedUsageRepo.increment.mockResolvedValue(
        ok(createFakeWhatsAppUsage({ outboundMessages: 10 })),
      )

      await WhatsAppUsageService.record('ws1', 'messages')

      expect(mockedUsageRepo.increment).toHaveBeenCalledWith(
        'ws1',
        '2026-10',
        'messages',
      )
      expect(mockedNotify).not.toHaveBeenCalled()
    })

    it.each([
      [50, 'messages', 100],
      [80, 'messages', 100],
      [100, 'messages', 100],
    ] as const)(
      'should notify everyone when crossing %i%%',
      async (threshold, metric, limit) => {
        limits(null, limit)
        mockedUsageRepo.increment.mockResolvedValue(
          ok(createFakeWhatsAppUsage({ outboundMessages: threshold })),
        )

        await WhatsAppUsageService.record('ws1', metric)

        expect(mockedNotify).toHaveBeenCalledWith({
          workspaceId: 'ws1',
          metric,
          threshold,
          period: '2026-10',
          used: threshold,
          limit,
        })
      },
    )

    it('should use the conversation counter and limit for conversations', async () => {
      limits(10, null)
      mockedUsageRepo.increment.mockResolvedValue(
        ok(createFakeWhatsAppUsage({ conversations: 8, outboundMessages: 99 })),
      )

      await WhatsAppUsageService.record('ws1', 'conversations')

      expect(mockedNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          metric: 'conversations',
          threshold: 80,
          used: 8,
          limit: 10,
        }),
      )
    })

    it('should not notify without a limit', async () => {
      limits(null, null)
      mockedUsageRepo.increment.mockResolvedValue(
        ok(createFakeWhatsAppUsage({ outboundMessages: 50 })),
      )
      await WhatsAppUsageService.record('ws1', 'messages')
      expect(mockedNotify).not.toHaveBeenCalled()
    })

    it('should swallow failures (never fails the send)', async () => {
      mockedUsageRepo.increment.mockResolvedValue(err(databaseError('boom')))
      await expect(
        WhatsAppUsageService.record('ws1', 'messages'),
      ).resolves.toBeUndefined()

      mockedUsageRepo.increment.mockRejectedValue(new Error('boom'))
      await expect(
        WhatsAppUsageService.record('ws1', 'messages'),
      ).resolves.toBeUndefined()
      expect(mockedNotify).not.toHaveBeenCalled()
    })
  })
})
