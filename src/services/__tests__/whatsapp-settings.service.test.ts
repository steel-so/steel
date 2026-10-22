import { describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppSettings } from '@/src/__tests__/factories/whatsapp-settings.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-settings.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import { WhatsAppSettingsService } from '../whatsapp-settings.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedSettingsRepo = vi.mocked(WhatsAppSettingsRepository)

function row(overrides: Parameters<typeof createFakeWhatsAppSettings>[0] = {}) {
  return createFakeWhatsAppSettings({
    id: 's1',
    workspaceId: 'ws1',
    ...overrides,
  })
}

function asRole(role: 'MEMBER' | 'ADMIN' | 'OWNER') {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

describe('WhatsAppSettingsService', () => {
  describe('get()', () => {
    it('should return the defaults when nothing was saved', async () => {
      asRole('ADMIN')
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(ok(null))

      expect(expectOk(await WhatsAppSettingsService.get('u1', 'ws1'))).toEqual(
        expect.objectContaining({
          workspaceId: 'ws1',
          autoCloseAfterHours: 24,
        }),
      )
    })

    it('should forbid a MEMBER (admin only)', async () => {
      asRole('MEMBER')
      expectErr(await WhatsAppSettingsService.get('u1', 'ws1'), 'FORBIDDEN')
    })
  })

  describe('update()', () => {
    it('should save the auto-close window and audit it', async () => {
      asRole('OWNER')
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(ok(null))
      mockedSettingsRepo.upsert.mockResolvedValue(
        ok(row({ autoCloseAfterHours: 0 })),
      )

      const dto = expectOk(
        await WhatsAppSettingsService.update('u1', 'ws1', {
          autoCloseAfterHours: 0,
        }),
      )

      expect(dto.autoCloseAfterHours).toBe(0)
      expect(mockedSettingsRepo.upsert).toHaveBeenCalledWith(
        'ws1',
        expect.objectContaining({ autoCloseAfterHours: 0 }),
      )
      expect(auditMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'whatsapp_settings',
          action: 'create',
          actorId: 'u1',
        }),
      )
    })

    it('should reject alert recipients that are not workspace members', async () => {
      asRole('ADMIN')
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(ok(null))
      mockedMembershipRepo.listWithUserByWorkspace.mockResolvedValue(
        ok([
          {
            ...createFakeMembership({ userId: 'u1', role: 'ADMIN' }),
            user: { id: 'u1', name: 'A', email: 'a@x.com', image: null },
          },
        ]),
      )

      expectErr(
        await WhatsAppSettingsService.update('u1', 'ws1', {
          sentimentAlertRecipientIds: ['u1', 'stranger'],
        }),
        'VALIDATION_ERROR',
      )
      expect(mockedSettingsRepo.upsert).not.toHaveBeenCalled()
    })

    it('should keep unspecified fields when saving the alert rule', async () => {
      asRole('ADMIN')
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(
        ok(row({ autoCloseAfterHours: 8 })),
      )
      mockedSettingsRepo.upsert.mockResolvedValue(ok(row()))

      expectOk(
        await WhatsAppSettingsService.update('u1', 'ws1', {
          sentimentAlertNotifyEmail: true,
        }),
      )
      expect(mockedSettingsRepo.upsert).toHaveBeenCalledWith(
        'ws1',
        expect.objectContaining({
          autoCloseAfterHours: 8,
          sentimentAlertNotifyEmail: true,
          sentimentAlertThreshold: -0.3,
        }),
      )
    })

    it('should save the close status rules', async () => {
      asRole('ADMIN')
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(ok(row()))
      mockedSettingsRepo.upsert.mockResolvedValue(ok(row()))

      expectOk(
        await WhatsAppSettingsService.update('u1', 'ws1', {
          closeStatusMinSelections: 1,
          closeStatusMaxSelections: 3,
        }),
      )
      expect(mockedSettingsRepo.upsert).toHaveBeenCalledWith(
        'ws1',
        expect.objectContaining({
          closeStatusMinSelections: 1,
          closeStatusMaxSelections: 3,
        }),
      )
    })

    it('should save the business hours with the days sorted and deduped', async () => {
      asRole('ADMIN')
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(ok(row()))
      mockedSettingsRepo.upsert.mockResolvedValue(ok(row()))

      expectOk(
        await WhatsAppSettingsService.update('u1', 'ws1', {
          businessHoursEnabled: true,
          businessHoursStart: '09:00',
          businessHoursEnd: '17:30',
          businessHoursDays: [5, 1, 1, 3],
        }),
      )
      expect(mockedSettingsRepo.upsert).toHaveBeenCalledWith(
        'ws1',
        expect.objectContaining({
          businessHoursEnabled: true,
          businessHoursStart: '09:00',
          businessHoursEnd: '17:30',
          businessHoursDays: [1, 3, 5],
        }),
      )
    })

    it('should save the "tem zap?" re-check TTL', async () => {
      asRole('ADMIN')
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(ok(row()))
      mockedSettingsRepo.upsert.mockResolvedValue(ok(row()))

      expectOk(
        await WhatsAppSettingsService.update('u1', 'ws1', {
          whatsappCheckTtlDays: 7,
        }),
      )
      expect(mockedSettingsRepo.upsert).toHaveBeenCalledWith(
        'ws1',
        expect.objectContaining({ whatsappCheckTtlDays: 7 }),
      )
    })

    it('should reject business hours that start and end at the same time', async () => {
      asRole('ADMIN')
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(ok(row()))

      expectErr(
        await WhatsAppSettingsService.update('u1', 'ws1', {
          businessHoursStart: '18:00',
        }),
        'VALIDATION_ERROR',
      )
    })

    it('should reject business hours turned on without weekdays', async () => {
      asRole('ADMIN')
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(ok(row()))

      expectErr(
        await WhatsAppSettingsService.update('u1', 'ws1', {
          businessHoursEnabled: true,
          businessHoursDays: [],
        }),
        'VALIDATION_ERROR',
      )
      expect(mockedSettingsRepo.upsert).not.toHaveBeenCalled()
    })

    it('should reject a close status minimum above the maximum', async () => {
      asRole('ADMIN')
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(
        ok(row({ closeStatusMaxSelections: 1 })),
      )

      expectErr(
        await WhatsAppSettingsService.update('u1', 'ws1', {
          closeStatusMinSelections: 2,
        }),
        'VALIDATION_ERROR',
      )
      expect(mockedSettingsRepo.upsert).not.toHaveBeenCalled()
    })

    it('should forbid a MEMBER', async () => {
      asRole('MEMBER')
      expectErr(
        await WhatsAppSettingsService.update('u1', 'ws1', {
          autoCloseAfterHours: 1,
        }),
        'FORBIDDEN',
      )
      expect(mockedSettingsRepo.upsert).not.toHaveBeenCalled()
    })
  })

  describe('listAutoCloseWindows()', () => {
    it('should skip disabled workspaces but still exclude them from the default', async () => {
      mockedSettingsRepo.listAll.mockResolvedValue(
        ok([
          row({ workspaceId: 'a', autoCloseAfterHours: 6 }),
          row({ workspaceId: 'b', autoCloseAfterHours: 0 }),
        ]),
      )

      expect(
        expectOk(await WhatsAppSettingsService.listAutoCloseWindows()),
      ).toEqual({
        configured: [{ workspaceId: 'a', hours: 6 }],
        configuredWorkspaceIds: ['a', 'b'],
        defaultHours: 24,
      })
    })
  })
})

describe('WhatsAppSettingsService failure paths and alert rule', () => {
  const DB_ERROR = { code: 'DATABASE_ERROR' as const, message: 'db down' }

  function member(userId: string) {
    return {
      ...createFakeMembership({ userId, role: 'ADMIN' }),
      user: { id: userId, name: userId, email: `${userId}@x.com`, image: null },
    }
  }

  it('get() should propagate a lookup failure', async () => {
    asRole('ADMIN')
    mockedSettingsRepo.findByWorkspace.mockResolvedValue(err(DB_ERROR))

    expectErr(await WhatsAppSettingsService.get('u1', 'ws1'), 'DATABASE_ERROR')
  })

  it('update() should propagate a lookup failure', async () => {
    asRole('ADMIN')
    mockedSettingsRepo.findByWorkspace.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppSettingsService.update('u1', 'ws1', {
        autoCloseAfterHours: 12,
      }),
      'DATABASE_ERROR',
    )
  })

  it('update() should propagate a member listing failure', async () => {
    asRole('ADMIN')
    mockedSettingsRepo.findByWorkspace.mockResolvedValue(ok(row()))
    mockedMembershipRepo.listWithUserByWorkspace.mockResolvedValue(
      err(DB_ERROR),
    )

    expectErr(
      await WhatsAppSettingsService.update('u1', 'ws1', {
        sentimentAlertAssignToId: 'sup1',
      }),
      'DATABASE_ERROR',
    )
  })

  it('update() should dedupe recipients and set the supervisor when all are members', async () => {
    asRole('ADMIN')
    mockedSettingsRepo.findByWorkspace.mockResolvedValue(ok(row()))
    mockedMembershipRepo.listWithUserByWorkspace.mockResolvedValue(
      ok([member('a1'), member('sup1')]) as never,
    )
    mockedSettingsRepo.upsert.mockResolvedValue(
      ok(row({ sentimentAlertRecipientIds: ['a1'] })),
    )

    expectOk(
      await WhatsAppSettingsService.update('u1', 'ws1', {
        sentimentAlertRecipientIds: ['a1', 'a1'],
        sentimentAlertAssignToId: 'sup1',
      }),
    )

    expect(mockedSettingsRepo.upsert).toHaveBeenCalledWith(
      'ws1',
      expect.objectContaining({
        sentimentAlertRecipientIds: ['a1'],
        sentimentAlertAssignToId: 'sup1',
      }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update' }),
    )
  })

  it('update() should clear the supervisor when null is sent', async () => {
    asRole('ADMIN')
    mockedSettingsRepo.findByWorkspace.mockResolvedValue(
      ok(row({ sentimentAlertAssignToId: 'sup1' })),
    )
    mockedSettingsRepo.upsert.mockResolvedValue(ok(row()))

    expectOk(
      await WhatsAppSettingsService.update('u1', 'ws1', {
        sentimentAlertAssignToId: null,
      }),
    )

    expect(mockedMembershipRepo.listWithUserByWorkspace).not.toHaveBeenCalled()
    expect(mockedSettingsRepo.upsert).toHaveBeenCalledWith(
      'ws1',
      expect.objectContaining({ sentimentAlertAssignToId: null }),
    )
  })

  it('update() should propagate a save failure', async () => {
    asRole('ADMIN')
    mockedSettingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    mockedSettingsRepo.upsert.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppSettingsService.update('u1', 'ws1', {
        autoCloseAfterHours: 12,
      }),
      'DATABASE_ERROR',
    )
  })

  it('listAutoCloseWindows() should propagate a listing failure', async () => {
    mockedSettingsRepo.listAll.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppSettingsService.listAutoCloseWindows(),
      'DATABASE_ERROR',
    )
  })

  it('getEffective() should propagate a lookup failure', async () => {
    mockedSettingsRepo.findByWorkspace.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppSettingsService.getEffective('ws1'),
      'DATABASE_ERROR',
    )
  })

  describe('call recording settings', () => {
    it('should default to recording off with the standard notice', async () => {
      asRole('ADMIN')
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(ok(null))

      expect(
        expectOk(await WhatsAppSettingsService.get('u1', 'ws1')),
      ).toMatchObject({
        callRecordingEnabled: false,
        callRecordingNotice: expect.stringContaining('gravada'),
        callRecordingRetentionDays: 90,
        callTranscriptionEnabled: true,
      })
    })

    it('should save the recording settings and audit the switch', async () => {
      asRole('ADMIN')
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(ok(row()))
      mockedSettingsRepo.upsert.mockResolvedValue(
        ok(
          row({
            callRecordingEnabled: true,
            callRecordingNotice: 'Avise o contato.',
            callRecordingRetentionDays: 30,
          }),
        ),
      )

      const dto = expectOk(
        await WhatsAppSettingsService.update('u1', 'ws1', {
          callRecordingEnabled: true,
          callRecordingNotice: 'Avise o contato.',
          callRecordingRetentionDays: 30,
        }),
      )

      expect(dto.callRecordingNotice).toBe('Avise o contato.')
      expect(mockedSettingsRepo.upsert).toHaveBeenCalledWith(
        'ws1',
        expect.objectContaining({
          callRecordingEnabled: true,
          callRecordingNotice: 'Avise o contato.',
          callRecordingRetentionDays: 30,
          callTranscriptionEnabled: true,
        }),
      )
      expect(auditMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({
            callRecordingEnabled: true,
            callRecordingRetentionDays: 30,
          }),
        }),
      )
    })

    it('should keep a saved notice when the field is not sent', async () => {
      asRole('ADMIN')
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(
        ok(row({ callRecordingNotice: 'Meu aviso' })),
      )
      mockedSettingsRepo.upsert.mockResolvedValue(ok(row()))

      expectOk(
        await WhatsAppSettingsService.update('u1', 'ws1', {
          callTranscriptionEnabled: false,
        }),
      )
      expect(mockedSettingsRepo.upsert).toHaveBeenCalledWith(
        'ws1',
        expect.objectContaining({
          callRecordingNotice: 'Meu aviso',
          callTranscriptionEnabled: false,
        }),
      )
    })

    it('should store null (the default notice) for an empty notice', async () => {
      asRole('ADMIN')
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(
        ok(row({ callRecordingNotice: 'Meu aviso' })),
      )
      mockedSettingsRepo.upsert.mockResolvedValue(ok(row()))

      expectOk(
        await WhatsAppSettingsService.update('u1', 'ws1', {
          callRecordingNotice: '',
        }),
      )
      expect(mockedSettingsRepo.upsert).toHaveBeenCalledWith(
        'ws1',
        expect.objectContaining({ callRecordingNotice: null }),
      )
    })

    it('should store null for a notice sent on a fresh workspace', async () => {
      asRole('ADMIN')
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(ok(null))
      mockedSettingsRepo.upsert.mockResolvedValue(ok(row()))

      expectOk(
        await WhatsAppSettingsService.update('u1', 'ws1', {
          autoCloseAfterHours: 4,
        }),
      )
      expect(mockedSettingsRepo.upsert).toHaveBeenCalledWith(
        'ws1',
        expect.objectContaining({ callRecordingNotice: null }),
      )
    })
  })
})
