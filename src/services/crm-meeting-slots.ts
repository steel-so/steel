import type { CrmMeetingAvailability, CrmMeetingPage } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { parseBusyIntervals } from '@/src/lib/crm-meetings/ics'
import {
  fetchIcs,
  ICS_FAILURE_MESSAGES,
} from '@/src/lib/crm-meetings/ics-fetch'
import { computeFreeSlots, type Interval } from '@/src/lib/scheduling/slots'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import { ensureRedisConnected, redis } from '@/src/lib/redis'
import { ok, type Result } from '@/src/lib/result'
import { weeklyHoursOf } from '@/src/mappers/crm-meeting.mapper'
import {
  CrmMeetingRepository,
  type MeetingPageWithHosts,
} from '@/src/repositories/crm-meeting.repository'

/**
 * Free-slot engine of the booking pages: merges, per seller, the weekly hours,
 * the confirmed bookings, the CRM agenda and the optional iCal feed. The first
 * calendar provider is the secret iCal address (Google/Outlook both give one);
 * OAuth providers plug in behind `loadFeedBusy` once the app registration
 * exists (see docs/crm-agendamento.md).
 */

const ICS_CACHE_SECONDS = 300
const FALLBACK_TIMEZONE = 'America/Sao_Paulo'

export interface SlotPlan {
  /** Start instant (ms) -> sellers free at that instant. */
  slots: Map<number, string[]>
}

async function loadFeedBusy(
  availability: CrmMeetingAvailability,
  from: Date,
  to: Date,
): Promise<Interval[]> {
  if (!availability.icsUrlEnc) return []
  const cacheKey = `crm-meetings:ics:${availability.id}`
  let text: string | null = null
  try {
    await ensureRedisConnected()
    text = await redis.get(cacheKey)
  } catch {
    text = null
  }
  if (text === null) {
    let url: string
    try {
      url = await decryptConnectionSecret(availability.icsUrlEnc)
    } catch {
      return []
    }
    const fetched = await fetchIcs(url)
    if (!fetched.ok) {
      logger.warn('crm.meetings.ics_failed', {
        availabilityId: availability.id,
        reason: fetched.reason,
      })
      void CrmMeetingRepository.recordIcsCheck(availability.id, {
        checkedAt: new Date(),
        error: ICS_FAILURE_MESSAGES[fetched.reason],
      })
      return []
    }
    text = fetched.text
    try {
      await redis.set(cacheKey, text, { EX: ICS_CACHE_SECONDS })
    } catch {
      // The cache is an optimisation only.
    }
    void CrmMeetingRepository.recordIcsCheck(availability.id, {
      checkedAt: new Date(),
      error: null,
    })
  }
  return parseBusyIntervals(text, { from, to, timezone: availability.timezone })
}

/** Free starts of a page inside `[from, to)`, with the sellers free at each. */
export async function planPageSlots(
  page:
    | MeetingPageWithHosts
    | (CrmMeetingPage & { hosts: MeetingPageWithHosts['hosts'] }),
  from: Date,
  to: Date,
  now: Date,
): Promise<Result<SlotPlan>> {
  const hostIds = page.hosts.map((host) => host.userId)
  if (hostIds.length === 0) return ok({ slots: new Map() })

  const [availabilities, busy] = await Promise.all([
    CrmMeetingRepository.availabilityOf(page.workspaceId, hostIds),
    CrmMeetingRepository.busyOf(
      page.workspaceId,
      hostIds,
      new Date(from.getTime() - 24 * 3600 * 1000),
      new Date(to.getTime() + 24 * 3600 * 1000),
    ),
  ])
  if (!availabilities.ok) return availabilities
  if (!busy.ok) return busy
  const byHost = new Map(availabilities.value.map((row) => [row.userId, row]))

  const slots = new Map<number, string[]>()
  for (const hostId of hostIds) {
    const availability = byHost.get(hostId) ?? null
    const feed = availability
      ? await loadFeedBusy(
          availability,
          new Date(from.getTime() - 24 * 3600 * 1000),
          new Date(to.getTime() + 24 * 3600 * 1000),
        )
      : []
    const starts = computeFreeSlots({
      from,
      to,
      now,
      durationMinutes: page.durationMinutes,
      bufferMinutes: page.bufferMinutes,
      stepMinutes: page.slotStepMinutes,
      minNoticeMinutes: page.minNoticeMinutes,
      maxDaysAhead: page.maxDaysAhead,
      timezone: availability?.timezone ?? FALLBACK_TIMEZONE,
      weeklyHours: weeklyHoursOf(availability),
      busy: [...(busy.value.get(hostId) ?? []), ...feed],
    })
    for (const start of starts) {
      const list = slots.get(start.getTime()) ?? []
      list.push(hostId)
      slots.set(start.getTime(), list)
    }
  }
  return ok({ slots })
}

/** Sellers free at an exact start, best round-robin candidate first. */
export async function freeHostsAt(
  page: MeetingPageWithHosts,
  start: Date,
  now: Date,
): Promise<Result<string[]>> {
  const plan = await planPageSlots(
    page,
    start,
    new Date(start.getTime() + 1),
    now,
  )
  if (!plan.ok) return plan
  const free = plan.value.slots.get(start.getTime())
  if (!free || free.length === 0) return ok([])
  return ok(roundRobinOrder(page, free))
}

/** Longest-idle seller first; ties keep the order configured on the page. */
export function roundRobinOrder(
  page: Pick<MeetingPageWithHosts, 'hosts'>,
  free: string[],
): string[] {
  const set = new Set(free)
  return page.hosts
    .filter((host) => set.has(host.userId))
    .sort((a, b) => {
      const left = a.lastAssignedAt?.getTime() ?? Number.NEGATIVE_INFINITY
      const right = b.lastAssignedAt?.getTime() ?? Number.NEGATIVE_INFINITY
      return left - right || a.position - b.position
    })
    .map((host) => host.userId)
}
