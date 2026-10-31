import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeMeetingAvailability } from '@/src/__tests__/factories/nov-crm-ops.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-meeting.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')
vi.mock('@/lib/axiom/audit')
vi.mock('@/src/lib/crypto', () => ({
  encryptConnectionSecret: vi.fn(async (v: string) => `enc:${v}`),
  decryptConnectionSecret: vi.fn(async (v: string) => v.replace('enc:', '')),
}))
vi.mock('@/src/lib/crm-meetings/ics-fetch', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/src/lib/crm-meetings/ics-fetch')
  >()),
  fetchIcs: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { fetchIcs } from '@/src/lib/crm-meetings/ics-fetch'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import { CrmMeetingRepository } from '@/src/repositories/crm-meeting.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import type { UpdateCrmMeetingAvailabilityDTO } from '@/src/schemas/crm-meeting.schema'
import { CrmMeetingAvailabilityService } from '../crm-meeting-availability.service'

const members = vi.mocked(MembershipRepository)
const repo = vi.mocked(CrmMeetingRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const fetchFeed = vi.mocked(fetchIcs)

const asRole = (role: Role) =>
  members.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )

const dto: UpdateCrmMeetingAvailabilityDTO = {
  timezone: 'America/Sao_Paulo',
  weeklyHours: { '1': [{ start: '09:00', end: '12:00' }] },
  icsUrl: undefined,
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(decryptConnectionSecret).mockImplementation(async (v: string) =>
    v.replace('enc:', ''),
  )
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
  asRole('MEMBER')
})

describe('get()', () => {
  it('should return the stored availability', async () => {
    repo.getAvailability.mockResolvedValue(
      ok(createFakeMeetingAvailability({ timezone: 'UTC' })),
    )

    const value = expectOk(await CrmMeetingAvailabilityService.get('u1', 'ws1'))

    expect(value.timezone).toBe('UTC')
    expect(value.oauthProvidersEnabled).toBe(false)
  })

  it('should fall back to the default hours and timezone', async () => {
    repo.getAvailability.mockResolvedValue(ok(null))

    const value = expectOk(await CrmMeetingAvailabilityService.get('u1', 'ws1'))

    expect(value.timezone).toBe('America/Sao_Paulo')
    expect(value.hasCalendarFeed).toBe(false)
  })

  it('should deny a non-member', async () => {
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(await CrmMeetingAvailabilityService.get('u1', 'ws1'))
    expect(repo.getAvailability).not.toHaveBeenCalled()
  })

  it('should deny when the CRM module is off', async () => {
    moduleAccess.isEnabled.mockResolvedValue(ok(false))

    expectErr(
      await CrmMeetingAvailabilityService.get('u1', 'ws1'),
      'MODULE_DISABLED',
    )
  })

  it('should propagate a database error', async () => {
    repo.getAvailability.mockResolvedValue(err(databaseError('x')))

    expectErr(
      await CrmMeetingAvailabilityService.get('u1', 'ws1'),
      'DATABASE_ERROR',
    )
  })
})

describe('update()', () => {
  beforeEach(() => {
    repo.upsertAvailability.mockImplementation(async (_w, _u, data) =>
      ok(
        createFakeMeetingAvailability({
          ...data,
          weeklyHours: data.weeklyHours as never,
        }),
      ),
    )
  })

  it('should save hours without a calendar feed', async () => {
    repo.getAvailability.mockResolvedValue(ok(null))

    const value = expectOk(
      await CrmMeetingAvailabilityService.update('u1', 'ws1', dto),
    )

    expect(value.hasCalendarFeed).toBe(false)
    expect(fetchFeed).not.toHaveBeenCalled()
    expect(vi.mocked(auditMutation)).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'crm_meeting_availability',
        action: 'update',
      }),
    )
  })

  it('should probe, encrypt and store a new feed address', async () => {
    repo.getAvailability.mockResolvedValue(ok(null))
    fetchFeed.mockResolvedValue({ ok: true, text: 'BEGIN:VCALENDAR' })

    const value = expectOk(
      await CrmMeetingAvailabilityService.update('u1', 'ws1', {
        ...dto,
        icsUrl: 'webcal://cal.example.com/a.ics',
      }),
    )

    expect(fetchFeed).toHaveBeenCalledWith('https://cal.example.com/a.ics')
    expect(repo.upsertAvailability.mock.calls[0][2].icsUrlEnc).toBe(
      'enc:https://cal.example.com/a.ics',
    )
    expect(value.hasCalendarFeed).toBe(true)
  })

  it('should reject an address the probe cannot read', async () => {
    repo.getAvailability.mockResolvedValue(ok(null))
    fetchFeed.mockResolvedValue({ ok: false, reason: 'private_host' })

    const error = expectErr(
      await CrmMeetingAvailabilityService.update('u1', 'ws1', {
        ...dto,
        icsUrl: 'https://10.0.0.1/a.ics',
      }),
      'CRM_MEETING_INVALID',
    )

    expect(error.message).toContain('rede privada')
    expect(repo.upsertAvailability).not.toHaveBeenCalled()
  })

  it('should keep the stored feed when the same address is sent again', async () => {
    repo.getAvailability.mockResolvedValue(
      ok(
        createFakeMeetingAvailability({
          icsUrlEnc: 'enc:https://cal.example.com/a.ics',
          icsLastError: 'old',
        }),
      ),
    )

    expectOk(
      await CrmMeetingAvailabilityService.update('u1', 'ws1', {
        ...dto,
        icsUrl: 'https://cal.example.com/a.ics',
      }),
    )

    expect(fetchFeed).not.toHaveBeenCalled()
    expect(repo.upsertAvailability.mock.calls[0][2]).toMatchObject({
      icsUrlEnc: 'enc:https://cal.example.com/a.ics',
      icsLastError: 'old',
    })
  })

  it('should probe again when the stored secret cannot be decrypted', async () => {
    repo.getAvailability.mockResolvedValue(
      ok(createFakeMeetingAvailability({ icsUrlEnc: 'corrupt' })),
    )
    vi.mocked(decryptConnectionSecret).mockRejectedValue(new Error('bad'))
    fetchFeed.mockResolvedValue({ ok: true, text: 'x' })

    expectOk(
      await CrmMeetingAvailabilityService.update('u1', 'ws1', {
        ...dto,
        icsUrl: 'https://cal.example.com/a.ics',
      }),
    )

    expect(fetchFeed).toHaveBeenCalledTimes(1)
  })

  it('should remove the feed when the address is null', async () => {
    repo.getAvailability.mockResolvedValue(
      ok(
        createFakeMeetingAvailability({
          icsUrlEnc: 'enc:x',
          icsLastError: 'e',
        }),
      ),
    )

    const value = expectOk(
      await CrmMeetingAvailabilityService.update('u1', 'ws1', {
        ...dto,
        icsUrl: null,
      }),
    )

    expect(value.hasCalendarFeed).toBe(false)
    expect(repo.upsertAvailability.mock.calls[0][2]).toMatchObject({
      icsUrlEnc: null,
      icsLastError: null,
    })
  })

  it('should keep the current feed when no address is sent', async () => {
    repo.getAvailability.mockResolvedValue(
      ok(createFakeMeetingAvailability({ icsUrlEnc: 'enc:x' })),
    )

    expectOk(await CrmMeetingAvailabilityService.update('u1', 'ws1', dto))

    expect(repo.upsertAvailability.mock.calls[0][2].icsUrlEnc).toBe('enc:x')
  })

  it('should deny a non-member and propagate repository errors', async () => {
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await CrmMeetingAvailabilityService.update('u1', 'ws1', dto))

    asRole('MEMBER')
    repo.getAvailability.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmMeetingAvailabilityService.update('u1', 'ws1', dto),
      'DATABASE_ERROR',
    )

    repo.getAvailability.mockResolvedValue(ok(null))
    repo.upsertAvailability.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmMeetingAvailabilityService.update('u1', 'ws1', dto),
      'DATABASE_ERROR',
    )
  })
})
