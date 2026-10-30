import type {
  CrmMeetingAvailability,
  CrmMeetingBooking,
  CrmMeetingHost,
  CrmMeetingPage,
  Prisma,
} from '@prisma/client'
import { crmMeetingSlotTaken, crmMeetingSlugTaken } from '@/src/errors'
import type { AppError } from '@/src/errors/app-error'
import type { Interval } from '@/src/lib/crm-meetings/slots'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export type MeetingPageWithHosts = CrmMeetingPage & { hosts: CrmMeetingHost[] }
export type MeetingBookingWithPage = CrmMeetingBooking & {
  page: Pick<CrmMeetingPage, 'title'>
}

export interface MeetingPageFields {
  slug: string
  title: string
  description: string | null
  durationMinutes: number
  bufferMinutes: number
  minNoticeMinutes: number
  maxDaysAhead: number
  slotStepMinutes: number
  timezone: string
  format: 'IN_PERSON' | 'ONLINE'
  location: string | null
  reminderMinutes: number
  leadSource: string
  active: boolean
}

class SlotTaken extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code: string }).code === 'P2002'
  )
}

const MINUTE = 60 * 1000

export const CrmMeetingRepository = {
  // ─── Pages ────────────────────────────────────────────────────────────────

  async createPage(
    workspaceId: string,
    createdById: string,
    fields: MeetingPageFields,
    hostUserIds: string[],
  ): Promise<Result<MeetingPageWithHosts>> {
    try {
      const page = await prisma.crmMeetingPage.create({
        data: {
          ...fields,
          workspaceId,
          createdById,
          hosts: {
            create: hostUserIds.map((userId, position) => ({
              userId,
              position,
            })),
          },
        },
        include: { hosts: { orderBy: { position: 'asc' } } },
      })
      return ok(page)
    } catch (error) {
      if (isUniqueViolation(error)) return err(crmMeetingSlugTaken())
      return err(dbError('Failed to create meeting page', error))
    }
  },

  async updatePage(
    id: string,
    fields: Partial<MeetingPageFields>,
    hostUserIds?: string[],
  ): Promise<Result<MeetingPageWithHosts>> {
    try {
      const page = await prisma.$transaction(async (tx) => {
        if (hostUserIds) {
          const current = await tx.crmMeetingHost.findMany({
            where: { pageId: id },
          })
          const keep = new Set(hostUserIds)
          await tx.crmMeetingHost.deleteMany({
            where: { pageId: id, userId: { notIn: hostUserIds } },
          })
          const known = new Set(current.map((host) => host.userId))
          for (const [position, userId] of hostUserIds.entries()) {
            if (known.has(userId)) {
              await tx.crmMeetingHost.updateMany({
                where: { pageId: id, userId },
                data: { position },
              })
            } else if (keep.has(userId)) {
              await tx.crmMeetingHost.create({
                data: { pageId: id, userId, position },
              })
            }
          }
        }
        return tx.crmMeetingPage.update({
          where: { id },
          data: fields,
          include: { hosts: { orderBy: { position: 'asc' } } },
        })
      })
      return ok(page)
    } catch (error) {
      if (isUniqueViolation(error)) return err(crmMeetingSlugTaken())
      return err(dbError('Failed to update meeting page', error))
    }
  },

  async softDeletePage(id: string): Promise<Result<void>> {
    try {
      await prisma.crmMeetingPage.update({
        where: { id },
        data: { deletedAt: new Date(), active: false },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete meeting page', error))
    }
  },

  async listPages(
    workspaceId: string,
  ): Promise<Result<MeetingPageWithHosts[]>> {
    try {
      return ok(
        await prisma.crmMeetingPage.findMany({
          where: { workspaceId, deletedAt: null },
          include: { hosts: { orderBy: { position: 'asc' } } },
          orderBy: { createdAt: 'desc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list meeting pages', error))
    }
  },

  async findPage(
    workspaceId: string,
    id: string,
  ): Promise<Result<MeetingPageWithHosts | null>> {
    try {
      return ok(
        await prisma.crmMeetingPage.findFirst({
          where: { id, workspaceId, deletedAt: null },
          include: { hosts: { orderBy: { position: 'asc' } } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find meeting page', error))
    }
  },

  async findPageBySlug(
    slug: string,
  ): Promise<
    Result<(MeetingPageWithHosts & { workspace: { name: string } }) | null>
  > {
    try {
      return ok(
        await prisma.crmMeetingPage.findFirst({
          where: { slug, deletedAt: null },
          include: {
            hosts: { orderBy: { position: 'asc' } },
            workspace: { select: { name: true } },
          },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find meeting page by slug', error))
    }
  },

  /** Any page by id (deleted ones too: a cancel notice still needs it). */
  async findPageWithWorkspace(
    id: string,
  ): Promise<
    Result<(CrmMeetingPage & { workspace: { name: string } }) | null>
  > {
    try {
      return ok(
        await prisma.crmMeetingPage.findUnique({
          where: { id },
          include: { workspace: { select: { name: true } } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find meeting page', error))
    }
  },

  async slugExists(slug: string): Promise<Result<boolean>> {
    try {
      return ok((await prisma.crmMeetingPage.count({ where: { slug } })) > 0)
    } catch (error) {
      return err(dbError('Failed to check meeting slug', error))
    }
  },

  async countUpcomingByPage(
    pageIds: string[],
    now: Date,
  ): Promise<Result<Map<string, number>>> {
    try {
      const rows = await prisma.crmMeetingBooking.groupBy({
        by: ['pageId'],
        where: {
          pageId: { in: pageIds },
          status: 'CONFIRMED',
          startsAt: { gte: now },
        },
        _count: { _all: true },
      })
      return ok(new Map(rows.map((row) => [row.pageId, row._count._all])))
    } catch (error) {
      return err(dbError('Failed to count upcoming bookings', error))
    }
  },

  // ─── People ───────────────────────────────────────────────────────────────

  /** Members of the workspace that may host (id -> name/email). */
  async membersByIds(
    workspaceId: string,
    userIds: string[],
  ): Promise<Result<Array<{ id: string; name: string; email: string }>>> {
    try {
      const rows = await prisma.membership.findMany({
        where: { workspaceId, userId: { in: userIds } },
        select: { user: { select: { id: true, name: true, email: true } } },
      })
      return ok(rows.map((row) => row.user))
    } catch (error) {
      return err(dbError('Failed to load meeting hosts', error))
    }
  },

  // ─── Availability ─────────────────────────────────────────────────────────

  async getAvailability(
    workspaceId: string,
    userId: string,
  ): Promise<Result<CrmMeetingAvailability | null>> {
    try {
      return ok(
        await prisma.crmMeetingAvailability.findUnique({
          where: { workspaceId_userId: { workspaceId, userId } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to load availability', error))
    }
  },

  async availabilityOf(
    workspaceId: string,
    userIds: string[],
  ): Promise<Result<CrmMeetingAvailability[]>> {
    try {
      return ok(
        await prisma.crmMeetingAvailability.findMany({
          where: { workspaceId, userId: { in: userIds } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to load availabilities', error))
    }
  },

  async upsertAvailability(
    workspaceId: string,
    userId: string,
    data: {
      timezone: string
      weeklyHours: Prisma.InputJsonValue
      icsUrlEnc: string | null
      icsCheckedAt: Date | null
      icsLastError: string | null
    },
  ): Promise<Result<CrmMeetingAvailability>> {
    try {
      return ok(
        await prisma.crmMeetingAvailability.upsert({
          where: { workspaceId_userId: { workspaceId, userId } },
          create: { workspaceId, userId, ...data },
          update: data,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to save availability', error))
    }
  },

  async recordIcsCheck(
    id: string,
    result: { checkedAt: Date; error: string | null },
  ): Promise<void> {
    try {
      await prisma.crmMeetingAvailability.update({
        where: { id },
        data: { icsCheckedAt: result.checkedAt, icsLastError: result.error },
      })
    } catch {
      // Bookkeeping only: a failed note never blocks the slot search.
    }
  },

  // ─── Busy time ────────────────────────────────────────────────────────────

  /** Confirmed bookings and calendar events of the hosts in a window. */
  async busyOf(
    workspaceId: string,
    userIds: string[],
    from: Date,
    to: Date,
  ): Promise<Result<Map<string, Interval[]>>> {
    try {
      const [bookings, events] = await Promise.all([
        prisma.crmMeetingBooking.findMany({
          where: {
            hostUserId: { in: userIds },
            status: 'CONFIRMED',
            startsAt: { lt: to },
            endsAt: { gt: from },
          },
          select: { hostUserId: true, startsAt: true, endsAt: true },
        }),
        prisma.crmCalendarEvent.findMany({
          where: {
            workspaceId,
            createdById: { in: userIds },
            startsAt: { lt: to },
            endsAt: { gt: from },
          },
          select: { createdById: true, startsAt: true, endsAt: true },
        }),
      ])
      const map = new Map<string, Interval[]>(userIds.map((id) => [id, []]))
      for (const row of bookings) {
        map.get(row.hostUserId)?.push({ start: row.startsAt, end: row.endsAt })
      }
      for (const row of events) {
        map.get(row.createdById)?.push({ start: row.startsAt, end: row.endsAt })
      }
      return ok(map)
    } catch (error) {
      return err(dbError('Failed to load busy time', error))
    }
  },

  // ─── Bookings ─────────────────────────────────────────────────────────────

  /**
   * Books the first free host of `candidates` (already in round-robin
   * order). Each host is locked for the transaction and re-checked against
   * confirmed bookings and calendar events, so two guests can never take the
   * same seller at the same time.
   */
  async book(input: {
    workspaceId: string
    page: Pick<CrmMeetingPage, 'id' | 'bufferMinutes' | 'title'>
    candidates: string[]
    startsAt: Date
    endsAt: Date
    guest: {
      name: string
      email: string
      phone: string | null
      notes: string | null
      timezone: string
    }
    manageToken: string
  }): Promise<Result<CrmMeetingBooking>> {
    try {
      const booking = await prisma.$transaction(async (tx) => {
        const buffer = input.page.bufferMinutes * MINUTE
        const from = new Date(input.startsAt.getTime() - buffer)
        const to = new Date(input.endsAt.getTime() + buffer)
        for (const hostUserId of input.candidates) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${hostUserId}))`
          const [clashes, events] = await Promise.all([
            tx.crmMeetingBooking.count({
              where: {
                hostUserId,
                status: 'CONFIRMED',
                startsAt: { lt: to },
                endsAt: { gt: from },
              },
            }),
            tx.crmCalendarEvent.count({
              where: {
                workspaceId: input.workspaceId,
                createdById: hostUserId,
                startsAt: { lt: to },
                endsAt: { gt: from },
              },
            }),
          ])
          if (clashes > 0 || events > 0) continue

          const event = await tx.crmCalendarEvent.create({
            data: {
              workspaceId: input.workspaceId,
              createdById: hostUserId,
              title: `${input.page.title} — ${input.guest.name}`,
              description: input.guest.notes,
              startsAt: input.startsAt,
              endsAt: input.endsAt,
              attendees: [input.guest.email],
            },
          })
          const created = await tx.crmMeetingBooking.create({
            data: {
              workspaceId: input.workspaceId,
              pageId: input.page.id,
              hostUserId,
              startsAt: input.startsAt,
              endsAt: input.endsAt,
              guestName: input.guest.name,
              guestEmail: input.guest.email,
              guestPhone: input.guest.phone,
              guestNotes: input.guest.notes,
              guestTimezone: input.guest.timezone,
              manageToken: input.manageToken,
              calendarEventId: event.id,
            },
          })
          await tx.crmMeetingHost.updateMany({
            where: { pageId: input.page.id, userId: hostUserId },
            data: { lastAssignedAt: new Date() },
          })
          return created
        }
        throw new SlotTaken()
      })
      return ok(booking)
    } catch (error) {
      if (error instanceof SlotTaken)
        return err(crmMeetingSlotTaken() as AppError)
      return err(dbError('Failed to book meeting', error))
    }
  },

  async attachLead(
    bookingId: string,
    leadId: string,
    calendarEventId: string | null,
    personId: string | null,
  ): Promise<void> {
    try {
      await prisma.crmMeetingBooking.update({
        where: { id: bookingId },
        data: { leadId },
      })
      if (calendarEventId && personId) {
        await prisma.crmCalendarEvent.update({
          where: { id: calendarEventId },
          data: { personId },
        })
      }
    } catch {
      // The booking stands; the lead link is best effort.
    }
  },

  async findBookingByToken(manageToken: string): Promise<
    Result<
      | (CrmMeetingBooking & {
          page: CrmMeetingPage & { workspace: { name: string } }
        })
      | null
    >
  > {
    try {
      return ok(
        await prisma.crmMeetingBooking.findUnique({
          where: { manageToken },
          include: {
            page: { include: { workspace: { select: { name: true } } } },
          },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find booking by token', error))
    }
  },

  async findBooking(
    workspaceId: string,
    id: string,
  ): Promise<Result<CrmMeetingBooking | null>> {
    try {
      return ok(
        await prisma.crmMeetingBooking.findFirst({
          where: { id, workspaceId },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find booking', error))
    }
  },

  async cancelBooking(
    id: string,
    canceledBy: 'guest' | 'host',
  ): Promise<Result<CrmMeetingBooking>> {
    try {
      const booking = await prisma.$transaction(async (tx) => {
        const updated = await tx.crmMeetingBooking.update({
          where: { id },
          data: { status: 'CANCELED', canceledAt: new Date(), canceledBy },
        })
        if (updated.calendarEventId) {
          await tx.crmCalendarEvent.deleteMany({
            where: { id: updated.calendarEventId },
          })
        }
        return updated
      })
      return ok(booking)
    } catch (error) {
      return err(dbError('Failed to cancel booking', error))
    }
  },

  async listBookings(
    workspaceId: string,
    filter: {
      scope: 'upcoming' | 'past' | 'all'
      hostUserId?: string
      now: Date
    },
  ): Promise<Result<MeetingBookingWithPage[]>> {
    try {
      return ok(
        await prisma.crmMeetingBooking.findMany({
          where: {
            workspaceId,
            ...(filter.hostUserId ? { hostUserId: filter.hostUserId } : {}),
            ...(filter.scope === 'upcoming'
              ? { startsAt: { gte: filter.now } }
              : filter.scope === 'past'
                ? { startsAt: { lt: filter.now } }
                : {}),
          },
          include: { page: { select: { title: true } } },
          orderBy: { startsAt: filter.scope === 'past' ? 'desc' : 'asc' },
          take: 200,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list bookings', error))
    }
  },

  /** Confirmed bookings starting inside the reminder window, not reminded. */
  async dueReminders(
    now: Date,
    limit: number,
  ): Promise<
    Result<
      Array<
        CrmMeetingBooking & {
          page: CrmMeetingPage & { workspace: { name: string } }
        }
      >
    >
  > {
    try {
      const candidates = await prisma.crmMeetingBooking.findMany({
        where: {
          status: 'CONFIRMED',
          reminderSentAt: null,
          startsAt: { gt: now, lt: new Date(now.getTime() + 48 * 60 * MINUTE) },
          page: { reminderMinutes: { gt: 0 }, deletedAt: null },
        },
        include: {
          page: { include: { workspace: { select: { name: true } } } },
        },
        orderBy: { startsAt: 'asc' },
        take: limit * 4,
      })
      return ok(
        candidates
          .filter(
            (row) =>
              row.startsAt.getTime() - row.page.reminderMinutes * MINUTE <=
              now.getTime(),
          )
          .slice(0, limit),
      )
    } catch (error) {
      return err(dbError('Failed to load due meeting reminders', error))
    }
  },

  /** Claims the reminder of a booking; false when another run took it. */
  async claimReminder(id: string): Promise<boolean> {
    try {
      const result = await prisma.crmMeetingBooking.updateMany({
        where: { id, reminderSentAt: null, status: 'CONFIRMED' },
        data: { reminderSentAt: new Date() },
      })
      return result.count === 1
    } catch {
      return false
    }
  },

  async markConfirmationSent(id: string): Promise<void> {
    await prisma.crmMeetingBooking
      .update({ where: { id }, data: { confirmationSentAt: new Date() } })
      .catch(() => undefined)
  },
}
