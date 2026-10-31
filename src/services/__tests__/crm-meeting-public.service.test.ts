import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeMeetingBooking,
  createFakeMeetingPage,
} from '@/src/__tests__/factories/nov-crm-ops.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/crm-meeting.repository')
vi.mock('@/src/repositories/crm-lead.repository')
vi.mock('@/src/repositories/crm-activity.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')
vi.mock('@/lib/axiom/audit')
vi.mock('@/lib/axiom/logger')
vi.mock('../crm-lead.service', () => ({ CrmLeadService: { intake: vi.fn() } }))
vi.mock('../crm-meeting-slots', () => ({
  freeHostsAt: vi.fn(),
  planPageSlots: vi.fn(),
}))
vi.mock('../notification-emitter', () => ({ emitNotification: vi.fn() }))
vi.mock('@/src/lib/mail/crm/send-meeting-booking', () => ({
  sendCrmMeetingEmail: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { sendCrmMeetingEmail } from '@/src/lib/mail/crm/send-meeting-booking'
import { CrmActivityRepository } from '@/src/repositories/crm-activity.repository'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import { CrmMeetingRepository } from '@/src/repositories/crm-meeting.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmLeadService } from '../crm-lead.service'
import {
  CrmMeetingPublicService,
  cancelBookingAndNotify,
  meetingManageUrl,
  meetingPublicPath,
  sendMeetingReminder,
  whenLabel,
} from '../crm-meeting-public.service'
import { freeHostsAt, planPageSlots } from '../crm-meeting-slots'
import { emitNotification } from '../notification-emitter'

const repo = vi.mocked(CrmMeetingRepository)
const leadRepo = vi.mocked(CrmLeadRepository)
const activity = vi.mocked(CrmActivityRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const intake = vi.mocked(CrmLeadService.intake)
const mail = vi.mocked(sendCrmMeetingEmail)
const emit = vi.mocked(emitNotification)
const hostsAt = vi.mocked(freeHostsAt)
const plan = vi.mocked(planPageSlots)

const live = () => ({
  ...createFakeMeetingPage(),
  workspace: { name: 'Acme' },
})
const bookingWithPage = (over = {}) => ({
  ...createFakeMeetingBooking({
    startsAt: new Date('2026-11-09T13:00:00Z'),
    endsAt: new Date('2026-11-09T13:30:00Z'),
    ...over,
  }),
  page: live(),
})

const guest = {
  consent: true as const,
  name: 'Cliente Teste',
  email: 'cliente@example.com',
  startsAt: '2026-11-09T13:00:00.000Z',
  timezone: 'America/Sao_Paulo',
}

const NOW = new Date('2026-11-08T12:00:00Z')

beforeEach(() => {
  vi.resetAllMocks()
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
  repo.findPageBySlug.mockResolvedValue(ok(live()))
  repo.membersByIds.mockResolvedValue(
    ok([{ id: 'host1', name: 'Ana Vendas', email: 'ana@acme.com' }]),
  )
  repo.markConfirmationSent.mockResolvedValue(undefined)
  repo.attachLead.mockResolvedValue(undefined)
  mail.mockResolvedValue(undefined as never)
})

describe('helpers', () => {
  it('should build the public and management paths', () => {
    expect(meetingPublicPath('vendas')).toBe('/m/vendas')
    expect(meetingManageUrl('tok')).toMatch(/\/m\/b\/tok$/)
  })

  it('should format the date in the given zone', () => {
    const label = whenLabel(
      new Date('2026-11-09T13:00:00Z'),
      'America/Sao_Paulo',
    )
    expect(label).toContain('10:00')
    expect(label).toContain('novembro')
  })
})

describe('getPage()', () => {
  it('should expose the public fields', async () => {
    const page = expectOk(await CrmMeetingPublicService.getPage('vendas'))

    expect(page).toMatchObject({
      slug: 'vendas',
      title: 'Conversa com vendas',
      workspaceName: 'Acme',
    })
  })

  it.each([
    ['missing', ok(null)],
    ['inactive', ok({ ...live(), active: false })],
  ])('should hide a %s page', async (_name, found) => {
    repo.findPageBySlug.mockResolvedValue(found as never)

    expectErr(
      await CrmMeetingPublicService.getPage('x'),
      'CRM_MEETING_PAGE_NOT_FOUND',
    )
  })

  it('should hide the page when the CRM module is off', async () => {
    moduleAccess.isEnabled.mockResolvedValue(ok(false))

    expectErr(
      await CrmMeetingPublicService.getPage('x'),
      'CRM_MEETING_PAGE_NOT_FOUND',
    )
  })

  it('should propagate a lookup error', async () => {
    repo.findPageBySlug.mockResolvedValue(err(databaseError('x')))

    expectErr(await CrmMeetingPublicService.getPage('x'), 'DATABASE_ERROR')
  })
})

describe('listSlots()', () => {
  it('should return the sorted ISO starts', async () => {
    plan.mockResolvedValue(
      ok({
        slots: new Map([
          [new Date('2026-11-09T14:00:00Z').getTime(), ['host1']],
          [new Date('2026-11-09T13:00:00Z').getTime(), ['host1']],
        ]),
      }),
    )

    const slots = expectOk(
      await CrmMeetingPublicService.listSlots('vendas', { days: 7 }, NOW),
    )

    expect(slots.slots).toEqual([
      '2026-11-09T13:00:00.000Z',
      '2026-11-09T14:00:00.000Z',
    ])
    expect(plan.mock.calls[0][1]).toEqual(NOW)
    expect(plan.mock.calls[0][2]).toEqual(new Date('2026-11-15T12:00:00Z'))
  })

  it('should honor an explicit start and default the clock', async () => {
    plan.mockResolvedValue(ok({ slots: new Map() }))

    expectOk(
      await CrmMeetingPublicService.listSlots('vendas', {
        days: 1,
        from: '2026-12-01T00:00:00.000Z',
      }),
    )

    expect(plan.mock.calls[0][1]).toEqual(new Date('2026-12-01T00:00:00Z'))
  })

  it('should propagate page and planning errors', async () => {
    plan.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmMeetingPublicService.listSlots('vendas', { days: 1 }, NOW),
      'DATABASE_ERROR',
    )

    repo.findPageBySlug.mockResolvedValue(ok(null))
    expectErr(
      await CrmMeetingPublicService.listSlots('vendas', { days: 1 }, NOW),
      'CRM_MEETING_PAGE_NOT_FOUND',
    )
  })
})

describe('book()', () => {
  beforeEach(() => {
    hostsAt.mockResolvedValue(ok(['host1']))
    repo.book.mockImplementation(async (input) =>
      ok(
        createFakeMeetingBooking({
          hostUserId: input.candidates[0],
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          manageToken: input.manageToken,
          guestName: input.guest.name,
          guestEmail: input.guest.email,
        }),
      ),
    )
    intake.mockResolvedValue(
      ok({ lead: { id: 'lead1', ownerId: null } } as never),
    )
    leadRepo.update.mockResolvedValue(ok({} as never))
    leadRepo.createMeeting.mockResolvedValue(ok({} as never))
    activity.record.mockResolvedValue(undefined as never)
  })

  it('should book, create the lead and meeting, mail and notify the host', async () => {
    const booking = expectOk(
      await CrmMeetingPublicService.book(
        'vendas',
        { ...guest, phone: '11999990000', notes: 'Quero uma demo' },
        NOW,
      ),
    )

    expect(booking.hostName).toBe('Ana Vendas')
    expect(booking.endsAt).toBe('2026-11-09T13:30:00.000Z')
    expect(repo.book).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        candidates: ['host1'],
        guest: expect.objectContaining({ phone: '11999990000' }),
      }),
    )
    expect(vi.mocked(auditMutation)).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'crm_meeting_booking',
        action: 'create',
      }),
    )
    expect(intake).toHaveBeenCalledWith(
      'ws1',
      expect.objectContaining({ via: 'meeting' }),
      expect.objectContaining({
        phones: ['11999990000'],
        channel: 'Agendamento',
      }),
    )
    expect(leadRepo.update).toHaveBeenCalledWith(
      'lead1',
      expect.objectContaining({ ownerId: 'host1' }),
    )
    expect(leadRepo.createMeeting).toHaveBeenCalledWith(
      expect.objectContaining({ interestDetails: 'Quero uma demo' }),
    )
    expect(activity.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MEETING_BOOKED', entityId: 'lead1' }),
    )
    expect(repo.attachLead).toHaveBeenCalled()
    expect(mail).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'confirmation', email: guest.email }),
      expect.objectContaining({
        ics: expect.stringContaining('METHOD:REQUEST'),
      }),
    )
    expect(repo.markConfirmationSent).toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        recipients: ['host1'],
        kind: 'CRM_MEETING_BOOKED',
      }),
    )
  })

  it('should keep the lead owner and default the meeting notes', async () => {
    intake.mockResolvedValue(
      ok({ lead: { id: 'lead1', ownerId: 'someone' } } as never),
    )

    expectOk(await CrmMeetingPublicService.book('vendas', guest, NOW))

    expect(leadRepo.update).not.toHaveBeenCalled()
    expect(leadRepo.createMeeting).toHaveBeenCalledWith(
      expect.objectContaining({
        interestDetails: 'Agendou pela página "Conversa com vendas"',
      }),
    )
    expect(intake.mock.calls[0][2].phones).toEqual([])
  })

  it('should still confirm the booking when the lead intake is rejected', async () => {
    intake.mockResolvedValue(err(databaseError('x')))

    expectOk(await CrmMeetingPublicService.book('vendas', guest, NOW))

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'crm.meetings.lead_failed',
      expect.objectContaining({ code: 'DATABASE_ERROR' }),
    )
    expect(leadRepo.createMeeting).not.toHaveBeenCalled()
    expect(mail).toHaveBeenCalled()
  })

  it('should still confirm the booking when the lead step throws', async () => {
    intake.mockRejectedValue(new Error('boom'))

    expectOk(await CrmMeetingPublicService.book('vendas', guest, NOW))

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'crm.meetings.lead_failed',
      expect.objectContaining({ error: 'boom' }),
    )
  })

  it('should not mark the confirmation as sent when the e-mail fails', async () => {
    mail.mockRejectedValue(new Error('smtp'))

    expectOk(await CrmMeetingPublicService.book('vendas', guest, NOW))

    expect(repo.markConfirmationSent).not.toHaveBeenCalled()
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'crm.meetings.email_failed',
      expect.objectContaining({ kind: 'confirmation', error: 'smtp' }),
    )
  })

  it('should stringify non-error mail failures and fall back to a generic host', async () => {
    mail.mockRejectedValue('nope')
    repo.membersByIds.mockResolvedValue(ok([]))

    const booking = expectOk(
      await CrmMeetingPublicService.book('vendas', guest, NOW),
    )

    expect(booking.hostName).toBe('Equipe')
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'crm.meetings.email_failed',
      expect.objectContaining({ error: 'nope' }),
    )
  })

  it('should fall back to a generic host when the members lookup fails', async () => {
    repo.membersByIds.mockResolvedValue(err(databaseError('x')))

    const booking = expectOk(
      await CrmMeetingPublicService.book('vendas', guest, NOW),
    )

    expect(booking.hostName).toBe('Equipe')
  })

  it('should answer slot taken when nobody is free', async () => {
    hostsAt.mockResolvedValue(ok([]))

    expectErr(
      await CrmMeetingPublicService.book('vendas', guest, NOW),
      'CRM_MEETING_SLOT_TAKEN',
    )
    expect(repo.book).not.toHaveBeenCalled()
  })

  it('should answer slot taken when the lock loses the race', async () => {
    repo.book.mockResolvedValue(
      err({ code: 'CRM_MEETING_SLOT_TAKEN', message: 'taken' } as never),
    )

    expectErr(
      await CrmMeetingPublicService.book('vendas', guest, NOW),
      'CRM_MEETING_SLOT_TAKEN',
    )
    expect(mail).not.toHaveBeenCalled()
  })

  it('should propagate page and availability errors', async () => {
    hostsAt.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmMeetingPublicService.book('vendas', guest, NOW),
      'DATABASE_ERROR',
    )

    repo.findPageBySlug.mockResolvedValue(ok(null))
    expectErr(
      await CrmMeetingPublicService.book('vendas', guest, NOW),
      'CRM_MEETING_PAGE_NOT_FOUND',
    )
  })

  it('should use the current time by default', async () => {
    hostsAt.mockResolvedValue(ok([]))

    await CrmMeetingPublicService.book('vendas', guest)

    expect(hostsAt.mock.calls[0][2]).toBeInstanceOf(Date)
  })
})

describe('getBooking()', () => {
  it('should return the booking for a valid token', async () => {
    repo.findBookingByToken.mockResolvedValue(ok(bookingWithPage()))

    const value = expectOk(await CrmMeetingPublicService.getBooking('tok123'))

    expect(value.hostName).toBe('Ana Vendas')
    expect(value.location).toBe('https://meet.example/x')
  })

  it('should hide the location of a canceled booking', async () => {
    repo.findBookingByToken.mockResolvedValue(
      ok(bookingWithPage({ status: 'CANCELED' })),
    )

    expect(
      expectOk(await CrmMeetingPublicService.getBooking('t')).location,
    ).toBeNull()
  })

  it('should answer not found and propagate errors', async () => {
    repo.findBookingByToken.mockResolvedValue(ok(null))
    expectErr(
      await CrmMeetingPublicService.getBooking('t'),
      'CRM_MEETING_BOOKING_NOT_FOUND',
    )

    repo.findBookingByToken.mockResolvedValue(err(databaseError('x')))
    expectErr(await CrmMeetingPublicService.getBooking('t'), 'DATABASE_ERROR')
  })
})

describe('cancel()', () => {
  beforeEach(() => {
    repo.findBookingByToken.mockResolvedValue(ok(bookingWithPage()))
    repo.findPageWithWorkspace.mockResolvedValue(ok(live()))
    repo.cancelBooking.mockImplementation(async () =>
      ok(createFakeMeetingBooking({ status: 'CANCELED' })),
    )
  })

  it('should cancel for the guest, mail the cancellation and tell the host', async () => {
    const value = expectOk(await CrmMeetingPublicService.cancel('tok123', NOW))

    expect(value.status).toBe('CANCELED')
    expect(repo.cancelBooking).toHaveBeenCalledWith('bk1', 'guest')
    expect(mail).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'canceled' }),
      expect.objectContaining({
        ics: expect.stringContaining('METHOD:CANCEL'),
      }),
    )
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: 'crm-meeting-canceled:bk1' }),
    )
    expect(vi.mocked(auditMutation)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'cancel',
        meta: expect.objectContaining({ by: 'guest' }),
      }),
    )
  })

  it('should refuse once the meeting has started', async () => {
    expectErr(
      await CrmMeetingPublicService.cancel(
        'tok123',
        new Date('2026-11-09T13:01:00Z'),
      ),
      'CRM_MEETING_INVALID',
    )
    expect(repo.cancelBooking).not.toHaveBeenCalled()
  })

  it('should be idempotent for an already canceled booking', async () => {
    repo.findBookingByToken.mockResolvedValue(
      ok(bookingWithPage({ status: 'CANCELED' })),
    )

    expectOk(await CrmMeetingPublicService.cancel('tok123', NOW))

    expect(repo.cancelBooking).not.toHaveBeenCalled()
  })

  it('should answer not found and propagate errors', async () => {
    repo.findBookingByToken.mockResolvedValue(ok(null))
    expectErr(
      await CrmMeetingPublicService.cancel('t', NOW),
      'CRM_MEETING_BOOKING_NOT_FOUND',
    )

    repo.findBookingByToken.mockResolvedValue(err(databaseError('x')))
    expectErr(await CrmMeetingPublicService.cancel('t', NOW), 'DATABASE_ERROR')

    repo.findBookingByToken.mockResolvedValue(ok(bookingWithPage()))
    repo.cancelBooking.mockResolvedValue(err(databaseError('x')))
    expectErr(await CrmMeetingPublicService.cancel('t', NOW), 'DATABASE_ERROR')
  })

  it('should default the clock', async () => {
    repo.findBookingByToken.mockResolvedValue(
      ok(bookingWithPage({ startsAt: new Date('2020-01-01T10:00:00Z') })),
    )

    expectErr(
      await CrmMeetingPublicService.cancel('tok123'),
      'CRM_MEETING_INVALID',
    )
  })
})

describe('cancelBookingAndNotify()', () => {
  it('should not notify the host when the host cancels', async () => {
    repo.findPageWithWorkspace.mockResolvedValue(ok(live()))
    repo.cancelBooking.mockResolvedValue(
      ok(createFakeMeetingBooking({ status: 'CANCELED' })),
    )

    expectOk(await cancelBookingAndNotify(createFakeMeetingBooking(), 'host'))

    expect(mail).toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it('should cancel quietly when the page is gone', async () => {
    repo.findPageWithWorkspace.mockResolvedValue(ok(null))
    repo.cancelBooking.mockResolvedValue(
      ok(createFakeMeetingBooking({ status: 'CANCELED' })),
    )

    expectOk(await cancelBookingAndNotify(createFakeMeetingBooking(), 'guest'))

    expect(mail).not.toHaveBeenCalled()
  })

  it('should cancel quietly when the page lookup fails', async () => {
    repo.findPageWithWorkspace.mockResolvedValue(err(databaseError('x')))
    repo.cancelBooking.mockResolvedValue(
      ok(createFakeMeetingBooking({ status: 'CANCELED' })),
    )

    expectOk(await cancelBookingAndNotify(createFakeMeetingBooking(), 'guest'))

    expect(mail).not.toHaveBeenCalled()
  })
})

describe('sendMeetingReminder()', () => {
  it('should send a reminder without a calendar invite', async () => {
    const delivered = await sendMeetingReminder(createFakeMeetingBooking(), {
      title: 'Conversa',
      location: null,
      format: 'ONLINE',
      workspace: { name: 'Acme' },
    })

    expect(delivered).toBe(true)
    expect(mail).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'reminder' }),
      expect.objectContaining({ ics: undefined }),
    )
  })

  it('should report a failed delivery', async () => {
    mail.mockRejectedValue(new Error('smtp'))

    expect(
      await sendMeetingReminder(createFakeMeetingBooking(), {
        title: 'Conversa',
        location: null,
        format: 'ONLINE',
        workspace: { name: 'Acme' },
      }),
    ).toBe(false)
  })
})
