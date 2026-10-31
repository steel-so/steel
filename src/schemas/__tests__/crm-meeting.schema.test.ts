import { describe, expect, it } from 'vitest'
import {
  BookCrmMeetingSchema,
  CreateCrmMeetingPageSchema,
  ListCrmMeetingBookingsSchema,
  MeetingSlugSchema,
  PublicSlotsQuerySchema,
  UpdateCrmMeetingAvailabilitySchema,
  UpdateCrmMeetingPageSchema,
} from '../crm-meeting.schema'

describe('MeetingSlugSchema', () => {
  it('lower-cases and validates', () => {
    expect(MeetingSlugSchema.parse(' Vendas-Sul ')).toBe('vendas-sul')
    expect(MeetingSlugSchema.safeParse('ab').success).toBe(false)
    expect(MeetingSlugSchema.safeParse('has space').success).toBe(false)
    expect(MeetingSlugSchema.safeParse('-bad-').success).toBe(false)
  })
})

describe('CreateCrmMeetingPageSchema', () => {
  const valid = { title: 'Conversa', hostUserIds: ['u1'] }

  it('applies defaults', () => {
    expect(CreateCrmMeetingPageSchema.parse(valid)).toMatchObject({
      durationMinutes: 30,
      bufferMinutes: 0,
      minNoticeMinutes: 120,
      maxDaysAhead: 30,
      slotStepMinutes: 30,
      timezone: 'America/Sao_Paulo',
      format: 'ONLINE',
      reminderMinutes: 60,
      active: true,
    })
  })

  it('requires a host and a sane duration and zone', () => {
    expect(
      CreateCrmMeetingPageSchema.safeParse({
        title: 'Conversa',
        hostUserIds: [],
      }).success,
    ).toBe(false)
    expect(
      CreateCrmMeetingPageSchema.safeParse({ ...valid, durationMinutes: 5 })
        .success,
    ).toBe(false)
    expect(
      CreateCrmMeetingPageSchema.safeParse({ ...valid, timezone: 'Mars/Base' })
        .success,
    ).toBe(false)
  })
})

describe('UpdateCrmMeetingPageSchema', () => {
  it('accepts a partial update and rejects an empty one', () => {
    expect(UpdateCrmMeetingPageSchema.parse({ title: 'Novo título' })).toEqual({
      title: 'Novo título',
    })
    expect(UpdateCrmMeetingPageSchema.safeParse({}).success).toBe(false)
  })
})

describe('UpdateCrmMeetingAvailabilitySchema', () => {
  it('validates windows and normalises an empty feed to null', () => {
    const parsed = UpdateCrmMeetingAvailabilitySchema.parse({
      timezone: 'America/Sao_Paulo',
      weeklyHours: { '1': [{ start: '09:00', end: '12:00' }] },
      icsUrl: '',
    })
    expect(parsed.icsUrl).toBeNull()
    expect(
      UpdateCrmMeetingAvailabilitySchema.safeParse({
        timezone: 'America/Sao_Paulo',
        weeklyHours: { '1': [{ start: '12:00', end: '09:00' }] },
      }).success,
    ).toBe(false)
    expect(
      UpdateCrmMeetingAvailabilitySchema.safeParse({
        timezone: 'America/Sao_Paulo',
        weeklyHours: { '9': [{ start: '09:00', end: '10:00' }] },
      }).success,
    ).toBe(false)
  })

  it('keeps a feed address when sent', () => {
    expect(
      UpdateCrmMeetingAvailabilitySchema.parse({
        timezone: 'UTC',
        weeklyHours: {},
        icsUrl: 'https://x/y.ics',
      }).icsUrl,
    ).toBe('https://x/y.ics')
  })
})

describe('public schemas', () => {
  it('bounds the slot window', () => {
    expect(PublicSlotsQuerySchema.parse({})).toEqual({ days: 14 })
    expect(PublicSlotsQuerySchema.safeParse({ days: '40' }).success).toBe(false)
    expect(
      PublicSlotsQuerySchema.safeParse({ from: 'yesterday' }).success,
    ).toBe(false)
  })

  it('requires consent and a valid e-mail to book', () => {
    const base = {
      startsAt: '2026-11-03T13:00:00.000Z',
      name: 'Ana',
      email: 'ANA@X.com',
      consent: true,
    }
    expect(BookCrmMeetingSchema.parse(base)).toMatchObject({
      email: 'ana@x.com',
      timezone: 'America/Sao_Paulo',
    })
    expect(
      BookCrmMeetingSchema.safeParse({ ...base, consent: false }).success,
    ).toBe(false)
    expect(
      BookCrmMeetingSchema.safeParse({ ...base, email: 'nope' }).success,
    ).toBe(false)
  })

  it('defaults the booking list', () => {
    expect(ListCrmMeetingBookingsSchema.parse({})).toEqual({
      scope: 'upcoming',
      mine: false,
    })
  })
})

describe('WeeklyHoursSchema windows', () => {
  it.each([
    ['unparseable start', { start: 'xx', end: '10:00' }],
    ['unparseable end', { start: '09:00', end: 'yy' }],
    ['end before start', { start: '10:00', end: '09:00' }],
  ])('rejects %s', (_name, window) => {
    expect(
      UpdateCrmMeetingAvailabilitySchema.safeParse({
        timezone: 'America/Sao_Paulo',
        weeklyHours: { '1': [window] },
      }).success,
    ).toBe(false)
  })
})
