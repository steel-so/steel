import { describe, expect, it } from 'vitest'
import {
  createFakeMeetingAvailability,
  createFakeMeetingBooking,
  createFakeMeetingBookingWithPage,
  createFakeMeetingHost,
  createFakeMeetingPage,
} from '@/src/__tests__/factories/nov-crm-ops.factory'
import { DEFAULT_WEEKLY_HOURS } from '@/src/lib/crm-meetings/slots'
import {
  toCrmMeetingAvailabilityDTO,
  toCrmMeetingBookingDTO,
  toCrmMeetingPageDTO,
  toPublicMeetingBookingDTO,
  weeklyHoursOf,
} from '../crm-meeting.mapper'

describe('crm-meeting mapper', () => {
  it('maps a page with host names', () => {
    const page = createFakeMeetingPage({
      hosts: [
        createFakeMeetingHost({ userId: 'u1' }),
        createFakeMeetingHost({ userId: 'gone' }),
      ],
    })
    const dto = toCrmMeetingPageDTO(
      page,
      new Map([['u1', { name: 'Ana', email: 'ana@x.com' }]]),
      3,
    )
    expect(dto.hosts).toEqual([
      { userId: 'u1', name: 'Ana', email: 'ana@x.com' },
      { userId: 'gone', name: 'Usuário removido', email: '' },
    ])
    expect(dto).toMatchObject({
      slug: 'vendas',
      upcomingBookings: 3,
      durationMinutes: 30,
    })
  })

  it('falls back to the default week when nothing is stored', () => {
    expect(weeklyHoursOf(null)).toBe(DEFAULT_WEEKLY_HOURS)
    expect(
      weeklyHoursOf(createFakeMeetingAvailability({ weeklyHours: {} })),
    ).toBe(DEFAULT_WEEKLY_HOURS)
    expect(
      weeklyHoursOf(
        createFakeMeetingAvailability({ weeklyHours: [] as never }),
      ),
    ).toBe(DEFAULT_WEEKLY_HOURS)
    const custom = { '2': [{ start: '08:00', end: '12:00' }] }
    expect(
      weeklyHoursOf(createFakeMeetingAvailability({ weeklyHours: custom })),
    ).toEqual(custom)
  })

  it('never exposes the calendar address', () => {
    const dto = toCrmMeetingAvailabilityDTO(
      createFakeMeetingAvailability({
        icsUrlEnc: 'secret-envelope',
        icsLastError: 'falhou',
      }),
      'UTC',
    )
    expect(dto).toMatchObject({
      hasCalendarFeed: true,
      calendarLastError: 'falhou',
      oauthProvidersEnabled: false,
    })
    expect(JSON.stringify(dto)).not.toContain('secret-envelope')
    expect(toCrmMeetingAvailabilityDTO(null, 'UTC')).toMatchObject({
      timezone: 'UTC',
      hasCalendarFeed: false,
    })
  })

  it('maps bookings for the seller and for the guest', () => {
    const mine = toCrmMeetingBookingDTO(
      createFakeMeetingBookingWithPage({
        canceledAt: new Date('2026-11-01T10:00:00Z'),
      }),
      'Ana',
    )
    expect(mine).toMatchObject({
      pageTitle: 'Conversa com vendas',
      hostName: 'Ana',
      canceledAt: '2026-11-01T10:00:00.000Z',
    })

    const page = {
      title: 'T',
      location: 'https://meet',
      format: 'ONLINE' as const,
      workspace: { name: 'Acme' },
    }
    const confirmed = toPublicMeetingBookingDTO(
      createFakeMeetingBooking(),
      page,
      'Ana',
    )
    expect(confirmed).toMatchObject({
      location: 'https://meet',
      workspaceName: 'Acme',
      hostName: 'Ana',
    })
    const canceled = toPublicMeetingBookingDTO(
      createFakeMeetingBooking({ status: 'CANCELED' }),
      page,
      'Ana',
    )
    expect(canceled.location).toBeNull()
  })
})
