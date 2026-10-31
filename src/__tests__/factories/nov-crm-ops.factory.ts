import { createId } from '@paralleldrive/cuid2'
import type {
  CrmDuplicateCandidate,
  CrmMeetingAvailability,
  CrmMeetingBooking,
  CrmMeetingHost,
  CrmMeetingPage,
  CrmMergeLog,
} from '@prisma/client'
import type { MergeSnapshot } from '@/src/repositories/crm-duplicate.repository'
import type {
  MeetingBookingWithPage,
  MeetingPageWithHosts,
} from '@/src/repositories/crm-meeting.repository'

export function createFakeDuplicateCandidate(
  overrides?: Partial<CrmDuplicateCandidate>,
): CrmDuplicateCandidate {
  const now = new Date('2026-10-30T12:00:00Z')
  return {
    id: createId(),
    workspaceId: createId(),
    entity: 'PERSON',
    leftId: 'p1',
    rightId: 'p2',
    score: 95,
    reasons: ['email'],
    status: 'PENDING',
    detectedAt: now,
    lastSeenAt: now,
    notifiedAt: null,
    resolvedAt: null,
    resolvedById: null,
    ...overrides,
  }
}

export function createFakeMergeSnapshot(
  overrides?: Partial<MergeSnapshot>,
): MergeSnapshot {
  return {
    version: 1,
    mergedBefore: {},
    survivorBefore: {},
    survivorAfter: {},
    moved: [],
    customFieldValueIds: [],
    names: { survivor: 'Ana Souza', merged: 'Ana S.' },
    ...overrides,
  }
}

export function createFakeMergeLog(
  overrides?: Partial<CrmMergeLog>,
): CrmMergeLog {
  const now = new Date('2026-10-30T12:00:00Z')
  return {
    id: createId(),
    workspaceId: createId(),
    entity: 'PERSON',
    survivorId: 'p1',
    mergedId: 'p2',
    candidateId: null,
    performedById: createId(),
    snapshot: createFakeMergeSnapshot() as never,
    createdAt: now,
    undoUntil: new Date(now.getTime() + 24 * 3600 * 1000),
    undoneAt: null,
    undoneById: null,
    ...overrides,
  }
}

export function createFakeMeetingHost(
  overrides?: Partial<CrmMeetingHost>,
): CrmMeetingHost {
  return {
    id: createId(),
    pageId: createId(),
    userId: createId(),
    position: 0,
    lastAssignedAt: null,
    ...overrides,
  }
}

export function createFakeMeetingPage(
  overrides?: Partial<CrmMeetingPage> & { hosts?: CrmMeetingHost[] },
): MeetingPageWithHosts {
  const now = new Date('2026-10-30T12:00:00Z')
  const { hosts = [createFakeMeetingHost({ userId: 'host1' })], ...rest } =
    overrides ?? {}
  return {
    id: 'page1',
    workspaceId: 'ws1',
    slug: 'vendas',
    title: 'Conversa com vendas',
    description: null,
    durationMinutes: 30,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    maxDaysAhead: 30,
    slotStepMinutes: 30,
    timezone: 'America/Sao_Paulo',
    format: 'ONLINE',
    location: 'https://meet.example/x',
    reminderMinutes: 60,
    leadSource: 'Agendamento de reunião',
    active: true,
    createdById: 'creator1',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...rest,
    hosts,
  }
}

export function createFakeMeetingAvailability(
  overrides?: Partial<CrmMeetingAvailability>,
): CrmMeetingAvailability {
  const now = new Date('2026-10-30T12:00:00Z')
  return {
    id: createId(),
    workspaceId: 'ws1',
    userId: 'host1',
    timezone: 'America/Sao_Paulo',
    weeklyHours: {},
    icsUrlEnc: null,
    icsCheckedAt: null,
    icsLastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeMeetingBooking(
  overrides?: Partial<CrmMeetingBooking>,
): CrmMeetingBooking {
  const now = new Date('2026-10-30T12:00:00Z')
  return {
    id: 'bk1',
    workspaceId: 'ws1',
    pageId: 'page1',
    hostUserId: 'host1',
    startsAt: new Date('2026-11-03T13:00:00Z'),
    endsAt: new Date('2026-11-03T13:30:00Z'),
    status: 'CONFIRMED',
    guestName: 'Cliente Teste',
    guestEmail: 'cliente@example.com',
    guestPhone: null,
    guestNotes: null,
    guestTimezone: 'America/Sao_Paulo',
    leadId: null,
    calendarEventId: 'ev1',
    manageToken: 'tok123',
    confirmationSentAt: null,
    reminderSentAt: null,
    canceledAt: null,
    canceledBy: null,
    createdAt: now,
    ...overrides,
  }
}

export function createFakeMeetingBookingWithPage(
  overrides?: Partial<CrmMeetingBooking>,
): MeetingBookingWithPage {
  return {
    ...createFakeMeetingBooking(overrides),
    page: { title: 'Conversa com vendas' },
  }
}
