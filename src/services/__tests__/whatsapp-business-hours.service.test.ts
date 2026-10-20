import { describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppSettings } from '@/src/__tests__/factories/whatsapp-settings.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-settings.repository')

import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import { WhatsAppBusinessHoursService } from '../whatsapp-business-hours.service'

const settingsRepo = vi.mocked(WhatsAppSettingsRepository)

// 2026-10-20 is a Tuesday; 22:00Z = 19:00 in São Paulo.
const EVENING = new Date('2026-10-20T22:00:00Z')
const MORNING = new Date('2026-10-20T13:00:00Z')

function withHours(enabled: boolean) {
  settingsRepo.findByWorkspace.mockResolvedValue(
    ok(
      createFakeWhatsAppSettings({
        workspaceId: 'ws1',
        businessHoursEnabled: enabled,
        businessHoursStart: '08:00',
        businessHoursEnd: '18:00',
        businessHoursDays: [1, 2, 3, 4, 5],
      }),
    ),
  )
}

describe('WhatsAppBusinessHoursService', () => {
  it('should let everything through when the hours are off', async () => {
    withHours(false)
    expectOk(await WhatsAppBusinessHoursService.assertOpen('ws1', EVENING))
  })

  it('should let sends through inside the window', async () => {
    withHours(true)
    expectOk(await WhatsAppBusinessHoursService.assertOpen('ws1', MORNING))
  })

  it('should lock sends outside the window and say when it opens', async () => {
    withHours(true)

    const error = expectErr(
      await WhatsAppBusinessHoursService.assertOpen('ws1', EVENING),
      'WHATSAPP_OUTSIDE_BUSINESS_HOURS',
    )
    expect(error.message).toContain('08:00–18:00')
    expect(error.message).toContain('até')
  })

  it('should give the next opening when closed', async () => {
    withHours(true)

    const checked = expectOk(
      await WhatsAppBusinessHoursService.check('ws1', EVENING),
    )
    expect(checked.open).toBe(false)
    expect(checked.nextOpeningAt).toEqual(new Date('2026-10-21T11:00:00Z'))
  })

  it('should expose the window to agents', async () => {
    vi.mocked(MembershipRepository.findByUserAndWorkspace).mockResolvedValue(
      ok(createFakeMembership({ role: 'MEMBER' })),
    )
    withHours(true)

    const status = expectOk(
      await WhatsAppBusinessHoursService.getStatus('u1', 'ws1'),
    )
    expect(status).toEqual(
      expect.objectContaining({
        enabled: true,
        start: '08:00',
        end: '18:00',
        days: [1, 2, 3, 4, 5],
      }),
    )
  })
})
