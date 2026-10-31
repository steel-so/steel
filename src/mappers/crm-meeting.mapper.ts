import type { CrmMeetingAvailability, CrmMeetingBooking } from '@prisma/client'
import {
  DEFAULT_WEEKLY_HOURS,
  type WeeklyHours,
} from '@/src/lib/crm-meetings/slots'
import type {
  MeetingBookingWithPage,
  MeetingPageWithHosts,
} from '@/src/repositories/crm-meeting.repository'
import type {
  CrmMeetingAvailabilityDTO,
  CrmMeetingBookingDTO,
  CrmMeetingHostDTO,
  CrmMeetingPageDTO,
  PublicMeetingBookingDTO,
  WeeklyHoursDTO,
} from '@/types/crm-meeting'

export function toCrmMeetingPageDTO(
  page: MeetingPageWithHosts,
  members: Map<string, { name: string; email: string }>,
  upcomingBookings: number,
): CrmMeetingPageDTO {
  const hosts: CrmMeetingHostDTO[] = page.hosts.map((host) => ({
    userId: host.userId,
    name: members.get(host.userId)?.name ?? 'Usuário removido',
    email: members.get(host.userId)?.email ?? '',
  }))
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    description: page.description,
    durationMinutes: page.durationMinutes,
    bufferMinutes: page.bufferMinutes,
    minNoticeMinutes: page.minNoticeMinutes,
    maxDaysAhead: page.maxDaysAhead,
    slotStepMinutes: page.slotStepMinutes,
    timezone: page.timezone,
    format: page.format,
    location: page.location,
    reminderMinutes: page.reminderMinutes,
    leadSource: page.leadSource,
    active: page.active,
    hosts,
    upcomingBookings,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  }
}

/** Stored hours as typed weekly hours (an empty week means "not set up"). */
export function weeklyHoursOf(row: CrmMeetingAvailability | null): WeeklyHours {
  const stored = row?.weeklyHours
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return DEFAULT_WEEKLY_HOURS
  }
  return Object.keys(stored).length === 0
    ? DEFAULT_WEEKLY_HOURS
    : (stored as unknown as WeeklyHours)
}

export function toCrmMeetingAvailabilityDTO(
  row: CrmMeetingAvailability | null,
  fallbackTimezone: string,
): CrmMeetingAvailabilityDTO {
  return {
    timezone: row?.timezone ?? fallbackTimezone,
    weeklyHours: weeklyHoursOf(row) as WeeklyHoursDTO,
    hasCalendarFeed: Boolean(row?.icsUrlEnc),
    calendarCheckedAt: row?.icsCheckedAt?.toISOString() ?? null,
    calendarLastError: row?.icsLastError ?? null,
    oauthProvidersEnabled: false,
  }
}

export function toCrmMeetingBookingDTO(
  booking: MeetingBookingWithPage,
  hostName: string,
): CrmMeetingBookingDTO {
  return {
    id: booking.id,
    pageId: booking.pageId,
    pageTitle: booking.page.title,
    hostUserId: booking.hostUserId,
    hostName,
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    status: booking.status,
    guestName: booking.guestName,
    guestEmail: booking.guestEmail,
    guestPhone: booking.guestPhone,
    guestNotes: booking.guestNotes,
    leadId: booking.leadId,
    canceledAt: booking.canceledAt?.toISOString() ?? null,
    createdAt: booking.createdAt.toISOString(),
  }
}

export function toPublicMeetingBookingDTO(
  booking: CrmMeetingBooking,
  page: {
    title: string
    location: string | null
    format: 'IN_PERSON' | 'ONLINE'
    workspace: { name: string }
  },
  hostName: string,
): PublicMeetingBookingDTO {
  return {
    manageToken: booking.manageToken,
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    hostName,
    pageTitle: page.title,
    location: booking.status === 'CONFIRMED' ? page.location : null,
    format: page.format,
    guestName: booking.guestName,
    status: booking.status,
    workspaceName: page.workspace.name,
  }
}
