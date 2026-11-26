import type { NotificationPreference } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/notification-preference.repository')
vi.mock('@/src/repositories/notification-delivery-setting.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { NotificationDeliverySettingRepository } from '@/src/repositories/notification-delivery-setting.repository'
import { NotificationPreferenceRepository } from '@/src/repositories/notification-preference.repository'
import { NotificationPreferenceService } from '../notification-preference.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedRepo = vi.mocked(NotificationPreferenceRepository)
const mockedAudit = vi.mocked(auditMutation)

const DB_ERROR = { code: 'DATABASE_ERROR' as const, message: 'down' }

function row(kind: string, inApp: boolean): NotificationPreference {
  return {
    id: `p-${kind}`,
    userId: 'u1',
    workspaceId: 'ws1',
    kind: kind as NotificationPreference['kind'],
    inApp,
    whatsapp: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  mockedRepo.listByUser.mockResolvedValue(ok([]))
  mockedRepo.upsertMany.mockResolvedValue(ok(1))
})

describe('NotificationPreferenceService.list', () => {
  it('should list every configurable kind, enabled by default', async () => {
    const items = expectOk(
      await NotificationPreferenceService.list('u1', 'ws1'),
    )

    expect(items.length).toBeGreaterThan(10)
    expect(items.every((item) => item.inApp)).toBe(true)
    expect(items.some((item) => item.module === 'SERVICE_DESK')).toBe(false)
    expect(items.find((item) => item.kind === 'CRM_LEAD_ASSIGNED')).toEqual({
      kind: 'CRM_LEAD_ASSIGNED',
      module: 'CRM',
      moduleLabel: 'CRM',
      label: 'Lead atribuído',
      icon: 'assign',
      color: 'violet',
      inApp: true,
      whatsapp: false,
    })
  })

  it('should reflect the saved mutes', async () => {
    mockedRepo.listByUser.mockResolvedValue(
      ok([row('CRM_TASK_DUE', false), row('MEMBER_JOINED', true)]),
    )

    const items = expectOk(
      await NotificationPreferenceService.list('u1', 'ws1'),
    )

    expect(items.find((i) => i.kind === 'CRM_TASK_DUE')?.inApp).toBe(false)
    expect(items.find((i) => i.kind === 'MEMBER_JOINED')?.inApp).toBe(true)
    expect(mockedRepo.listByUser).toHaveBeenCalledWith('ws1', 'u1')
  })

  it('should forbid non-members', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(
      await NotificationPreferenceService.list('u1', 'ws1'),
      'FORBIDDEN',
    )
    expect(mockedRepo.listByUser).not.toHaveBeenCalled()
  })

  it('should propagate a database error', async () => {
    mockedRepo.listByUser.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await NotificationPreferenceService.list('u1', 'ws1'),
      'DATABASE_ERROR',
    )
  })
})

describe('NotificationPreferenceService.update', () => {
  it('should save the own preferences (last one wins) and audit the change', async () => {
    mockedRepo.listByUser.mockResolvedValue(ok([row('CRM_TASK_DUE', false)]))

    const items = expectOk(
      await NotificationPreferenceService.update('u1', 'ws1', {
        preferences: [
          { kind: 'CRM_TASK_DUE', inApp: true },
          { kind: 'CRM_TASK_DUE', inApp: false },
          { kind: 'MEMBER_JOINED', inApp: true },
        ],
      }),
    )

    expect(mockedRepo.upsertMany).toHaveBeenCalledWith('ws1', 'u1', [
      { kind: 'CRM_TASK_DUE', inApp: false },
      { kind: 'MEMBER_JOINED', inApp: true },
    ])
    expect(mockedAudit).toHaveBeenCalledWith({
      entity: 'notification_preference',
      action: 'update',
      actorId: 'u1',
      meta: {
        workspaceId: 'ws1',
        muted: ['CRM_TASK_DUE'],
        unmuted: ['MEMBER_JOINED'],
        whatsappOn: [],
        whatsappOff: [],
      },
    })
    expect(items.find((i) => i.kind === 'CRM_TASK_DUE')?.inApp).toBe(false)
  })

  it('should forbid non-members', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(
      await NotificationPreferenceService.update('u1', 'ws1', {
        preferences: [{ kind: 'CRM_TASK_DUE', inApp: false }],
      }),
      'FORBIDDEN',
    )
    expect(mockedRepo.upsertMany).not.toHaveBeenCalled()
  })

  it('should audit and propagate a save failure', async () => {
    mockedRepo.upsertMany.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await NotificationPreferenceService.update('u1', 'ws1', {
        preferences: [{ kind: 'CRM_TASK_DUE', inApp: false }],
      }),
      'DATABASE_ERROR',
    )
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        reason: 'DATABASE_ERROR',
      }),
    )
  })
})

const mockedDeliveryRepo = vi.mocked(NotificationDeliverySettingRepository)

function deliveryRow(browserEnabled: boolean) {
  return {
    id: 'd1',
    userId: 'u1',
    workspaceId: 'ws1',
    browserEnabled,
    whatsappEnabled: false,
    whatsappNumber: null,
    whatsappVerifiedAt: null,
    whatsappCodeHash: null,
    whatsappCodeExpiresAt: null,
    whatsappCodeAttempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

describe('NotificationPreferenceService.getDelivery', () => {
  it('should default to browser notifications off when nothing was saved', async () => {
    mockedDeliveryRepo.find.mockResolvedValue(ok(null))

    expect(
      expectOk(await NotificationPreferenceService.getDelivery('u1', 'ws1')),
    ).toEqual({ browserEnabled: false })
    expect(mockedDeliveryRepo.find).toHaveBeenCalledWith('ws1', 'u1')
  })

  it('should return the saved choice', async () => {
    mockedDeliveryRepo.find.mockResolvedValue(ok(deliveryRow(true)))

    expect(
      expectOk(await NotificationPreferenceService.getDelivery('u1', 'ws1')),
    ).toEqual({ browserEnabled: true })
  })

  it('should forbid non-members', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(
      await NotificationPreferenceService.getDelivery('x', 'ws1'),
      'FORBIDDEN',
    )
    expect(mockedDeliveryRepo.find).not.toHaveBeenCalled()
  })

  it('should propagate a database error', async () => {
    mockedDeliveryRepo.find.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await NotificationPreferenceService.getDelivery('u1', 'ws1'),
      'DATABASE_ERROR',
    )
  })
})

describe('NotificationPreferenceService.updateDelivery', () => {
  it('should save the own choice and audit it', async () => {
    mockedDeliveryRepo.upsert.mockResolvedValue(ok(deliveryRow(true)))

    expect(
      expectOk(
        await NotificationPreferenceService.updateDelivery('u1', 'ws1', {
          browserEnabled: true,
        }),
      ),
    ).toEqual({ browserEnabled: true })
    expect(mockedDeliveryRepo.upsert).toHaveBeenCalledWith('ws1', 'u1', {
      browserEnabled: true,
    })
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'notification_preference',
        action: 'update',
        actorId: 'u1',
        meta: expect.objectContaining({
          channel: 'browser',
          browserEnabled: true,
        }),
      }),
    )
  })

  it('should forbid non-members', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(
      await NotificationPreferenceService.updateDelivery('x', 'ws1', {
        browserEnabled: true,
      }),
      'FORBIDDEN',
    )
    expect(mockedDeliveryRepo.upsert).not.toHaveBeenCalled()
  })

  it('should audit and propagate a save failure', async () => {
    mockedDeliveryRepo.upsert.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await NotificationPreferenceService.updateDelivery('u1', 'ws1', {
        browserEnabled: false,
      }),
      'DATABASE_ERROR',
    )
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        reason: 'DATABASE_ERROR',
        meta: expect.objectContaining({ channel: 'browser' }),
      }),
    )
  })
})
