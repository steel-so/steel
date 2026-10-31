export type CrmMeetingFormat = 'IN_PERSON' | 'ONLINE'
export type CrmMeetingBookingStatus = 'CONFIRMED' | 'CANCELED'

export interface CrmMeetingHostDTO {
  userId: string
  name: string
  email: string
}

export interface CrmMeetingPageDTO {
  id: string
  slug: string
  title: string
  description: string | null
  durationMinutes: number
  bufferMinutes: number
  minNoticeMinutes: number
  maxDaysAhead: number
  slotStepMinutes: number
  timezone: string
  format: CrmMeetingFormat
  location: string | null
  reminderMinutes: number
  leadSource: string
  active: boolean
  hosts: CrmMeetingHostDTO[]
  upcomingBookings: number
  createdAt: string
  updatedAt: string
}

export type WeeklyHoursDTO = Record<string, Array<{ start: string; end: string }>>

export interface CrmMeetingAvailabilityDTO {
  timezone: string
  weeklyHours: WeeklyHoursDTO
  /** A calendar feed is connected (the address itself is never returned). */
  hasCalendarFeed: boolean
  calendarCheckedAt: string | null
  calendarLastError: string | null
  /** Google / Outlook by OAuth are off: they need the app registration. */
  oauthProvidersEnabled: false
}

export interface CrmMeetingBookingDTO {
  id: string
  pageId: string
  pageTitle: string
  hostUserId: string
  hostName: string
  startsAt: string
  endsAt: string
  status: CrmMeetingBookingStatus
  guestName: string
  guestEmail: string
  guestPhone: string | null
  guestNotes: string | null
  leadId: string | null
  canceledAt: string | null
  createdAt: string
}

/** What the public page shows (no internal ids beyond the slug). */
export interface PublicMeetingPageDTO {
  slug: string
  title: string
  description: string | null
  durationMinutes: number
  timezone: string
  format: CrmMeetingFormat
  workspaceName: string
}

export interface PublicMeetingSlotsDTO {
  timezone: string
  durationMinutes: number
  slots: string[]
}

export interface PublicMeetingBookingDTO {
  manageToken: string
  startsAt: string
  endsAt: string
  hostName: string
  pageTitle: string
  location: string | null
  format: CrmMeetingFormat
  guestName: string
  status: CrmMeetingBookingStatus
  workspaceName: string
}
