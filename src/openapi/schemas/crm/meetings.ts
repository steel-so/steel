import { z } from 'zod'
import { dto } from '../../common'

/** DTOs do agendamento de reuniões (`types/crm-meeting.d.ts`). */

const Format = z.enum(['IN_PERSON', 'ONLINE'])
const Status = z.enum(['CONFIRMED', 'CANCELED'])

export const CrmMeetingHostDTO = dto(
  'CrmMeetingHost',
  z.object({ userId: z.string(), name: z.string(), email: z.string() }),
)

export const CrmMeetingPageDTO = dto(
  'CrmMeetingPage',
  z.object({
    id: z.string(),
    slug: z
      .string()
      .meta({ description: 'A página pública fica em `/m/<slug>`.' }),
    title: z.string(),
    description: z.string().nullable(),
    durationMinutes: z.number().int(),
    bufferMinutes: z.number().int(),
    minNoticeMinutes: z.number().int(),
    maxDaysAhead: z.number().int(),
    slotStepMinutes: z.number().int(),
    timezone: z.string(),
    format: Format,
    location: z.string().nullable(),
    reminderMinutes: z.number().int(),
    leadSource: z.string(),
    active: z.boolean(),
    hosts: z.array(CrmMeetingHostDTO),
    upcomingBookings: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
)

export const CrmMeetingAvailabilityDTO = dto(
  'CrmMeetingAvailability',
  z.object({
    timezone: z.string(),
    weeklyHours: z.record(
      z.string(),
      z.array(z.object({ start: z.string(), end: z.string() })),
    ),
    hasCalendarFeed: z.boolean().meta({
      description:
        'Há um endereço iCal conectado (o endereço nunca é devolvido).',
    }),
    calendarCheckedAt: z.iso.datetime().nullable(),
    calendarLastError: z.string().nullable(),
    oauthProvidersEnabled: z.literal(false).meta({
      description:
        'Google e Outlook por OAuth ficam desligados até o registro do aplicativo.',
    }),
  }),
)

export const CrmMeetingBookingDTO = dto(
  'CrmMeetingBooking',
  z.object({
    id: z.string(),
    pageId: z.string(),
    pageTitle: z.string(),
    hostUserId: z.string(),
    hostName: z.string(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    status: Status,
    guestName: z.string(),
    guestEmail: z.string(),
    guestPhone: z.string().nullable(),
    guestNotes: z.string().nullable(),
    leadId: z.string().nullable(),
    canceledAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  }),
)

export const PublicMeetingPageDTO = dto(
  'PublicMeetingPage',
  z.object({
    slug: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    durationMinutes: z.number().int(),
    timezone: z.string(),
    format: Format,
    workspaceName: z.string(),
  }),
)

export const PublicMeetingSlotsDTO = dto(
  'PublicMeetingSlots',
  z.object({
    timezone: z.string(),
    durationMinutes: z.number().int(),
    slots: z.array(z.iso.datetime()).meta({
      description: 'Início de cada horário livre, em UTC, em ordem crescente.',
    }),
  }),
)

export const PublicMeetingBookingDTO = dto(
  'PublicMeetingBooking',
  z.object({
    manageToken: z.string(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    hostName: z.string(),
    pageTitle: z.string(),
    location: z.string().nullable(),
    format: Format,
    guestName: z.string(),
    status: Status,
    workspaceName: z.string(),
  }),
)
