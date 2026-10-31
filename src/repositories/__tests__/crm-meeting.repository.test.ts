import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedMembership } from '@/src/__tests__/factories/membership.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  CrmMeetingRepository,
  type MeetingPageFields,
} from '../crm-meeting.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

const fields = (slug: string, over: Partial<MeetingPageFields> = {}) => ({
  slug,
  title: 'Conversa',
  description: null,
  durationMinutes: 30,
  bufferMinutes: 0,
  minNoticeMinutes: 0,
  maxDaysAhead: 30,
  slotStepMinutes: 30,
  timezone: 'America/Sao_Paulo',
  format: 'ONLINE' as const,
  location: null,
  reminderMinutes: 60,
  leadSource: 'Agendamento',
  active: true,
  ...over,
})

let counter = 0
const slug = () => `pg-${Date.now().toString(36)}-${counter++}`

async function setup(hostCount = 2) {
  const workspace = await seedWorkspace()
  const users = await Promise.all(
    Array.from({ length: hostCount }, () => seedUser()),
  )
  for (const user of users) {
    await seedMembership({ userId: user.id, workspaceId: workspace.id })
  }
  const page = expectOk(
    await CrmMeetingRepository.createPage(
      workspace.id,
      users[0].id,
      fields(slug()),
      users.map((u) => u.id),
    ),
  )
  return { workspace, users, page }
}

const at = (iso: string) => new Date(iso)
const START = at('2026-11-10T13:00:00Z')
const END = at('2026-11-10T13:30:00Z')

function bookInput(
  workspaceId: string,
  page: { id: string; bufferMinutes: number; title: string },
  candidates: string[],
  over: { startsAt?: Date; endsAt?: Date; token?: string } = {},
) {
  return {
    workspaceId,
    page,
    candidates,
    startsAt: over.startsAt ?? START,
    endsAt: over.endsAt ?? END,
    guest: {
      name: 'Cliente',
      email: 'c@example.com',
      phone: null,
      notes: 'obs',
      timezone: 'America/Sao_Paulo',
    },
    manageToken: over.token ?? `tok-${counter++}-${Math.random()}`,
  }
}

describe('CrmMeetingRepository', () => {
  describe('pages', () => {
    it('should create a page with ordered hosts and find it by id and slug', async () => {
      const { workspace, users, page } = await setup()

      expect(page.hosts.map((h) => h.userId)).toEqual(users.map((u) => u.id))
      expect(
        expectOk(await CrmMeetingRepository.findPage(workspace.id, page.id))
          ?.id,
      ).toBe(page.id)
      const bySlug = expectOk(
        await CrmMeetingRepository.findPageBySlug(page.slug),
      )
      expect(bySlug?.workspace.name).toBe(workspace.name)
      const withWorkspace = expectOk(
        await CrmMeetingRepository.findPageWithWorkspace(page.id),
      )
      expect(withWorkspace?.workspace.name).toBe(workspace.name)
      expect(expectOk(await CrmMeetingRepository.slugExists(page.slug))).toBe(
        true,
      )
      expect(expectOk(await CrmMeetingRepository.slugExists('nope'))).toBe(
        false,
      )
    })

    it('should not find a page of another workspace', async () => {
      const { page } = await setup()
      const other = await seedWorkspace()

      expect(
        expectOk(await CrmMeetingRepository.findPage(other.id, page.id)),
      ).toBeNull()
    })

    it('should reject a duplicate slug on create and on update', async () => {
      const { workspace, users, page } = await setup()
      const second = expectOk(
        await CrmMeetingRepository.createPage(
          workspace.id,
          users[0].id,
          fields(slug()),
          [users[0].id],
        ),
      )

      expectErr(
        await CrmMeetingRepository.createPage(
          workspace.id,
          users[0].id,
          fields(page.slug),
          [users[0].id],
        ),
        'CRM_MEETING_SLUG_TAKEN',
      )
      expectErr(
        await CrmMeetingRepository.updatePage(second.id, { slug: page.slug }),
        'CRM_MEETING_SLUG_TAKEN',
      )
    })

    it('should update fields and reshuffle the hosts', async () => {
      const { workspace, users, page } = await setup(2)
      const third = await seedUser()
      await seedMembership({ userId: third.id, workspaceId: workspace.id })

      const updated = expectOk(
        await CrmMeetingRepository.updatePage(
          page.id,
          { title: 'Novo título' },
          [third.id, users[1].id],
        ),
      )

      expect(updated.title).toBe('Novo título')
      expect(updated.hosts.map((h) => h.userId)).toEqual([
        third.id,
        users[1].id,
      ])
    })

    it('should update fields without touching the hosts', async () => {
      const { page } = await setup(1)

      const updated = expectOk(
        await CrmMeetingRepository.updatePage(page.id, { active: false }),
      )

      expect(updated.active).toBe(false)
      expect(updated.hosts).toHaveLength(1)
    })

    it('should soft delete a page and hide it from lists and public lookups', async () => {
      const { workspace, page } = await setup()

      expectOk(await CrmMeetingRepository.softDeletePage(page.id))

      expect(
        expectOk(await CrmMeetingRepository.listPages(workspace.id)),
      ).toEqual([])
      expect(
        expectOk(await CrmMeetingRepository.findPageBySlug(page.slug)),
      ).toBeNull()
      expect(
        expectOk(await CrmMeetingRepository.findPageWithWorkspace(page.id)),
      ).not.toBeNull()
    })

    it('should list pages newest first', async () => {
      const { workspace, users, page } = await setup(1)
      const newer = expectOk(
        await CrmMeetingRepository.createPage(
          workspace.id,
          users[0].id,
          fields(slug()),
          [users[0].id],
        ),
      )

      const list = expectOk(await CrmMeetingRepository.listPages(workspace.id))

      expect(list.map((p) => p.id)).toEqual([newer.id, page.id])
    })

    it('should resolve members of the workspace only', async () => {
      const { workspace, users } = await setup(2)
      const outsider = await seedUser()

      const found = expectOk(
        await CrmMeetingRepository.membersByIds(workspace.id, [
          users[0].id,
          outsider.id,
        ]),
      )

      expect(found.map((u) => u.id)).toEqual([users[0].id])
    })
  })

  describe('availability', () => {
    it('should upsert, read and annotate the calendar check', async () => {
      const { workspace, users } = await setup(1)
      const base = {
        timezone: 'America/Sao_Paulo',
        weeklyHours: { mon: [{ start: '09:00', end: '12:00' }] },
        icsUrlEnc: null,
        icsCheckedAt: null,
        icsLastError: null,
      }

      expect(
        expectOk(
          await CrmMeetingRepository.getAvailability(workspace.id, users[0].id),
        ),
      ).toBeNull()
      const first = expectOk(
        await CrmMeetingRepository.upsertAvailability(
          workspace.id,
          users[0].id,
          base,
        ),
      )
      const second = expectOk(
        await CrmMeetingRepository.upsertAvailability(
          workspace.id,
          users[0].id,
          { ...base, timezone: 'UTC' },
        ),
      )
      expect(second.id).toBe(first.id)
      expect(second.timezone).toBe('UTC')

      const rows = expectOk(
        await CrmMeetingRepository.availabilityOf(workspace.id, [users[0].id]),
      )
      expect(rows).toHaveLength(1)

      await CrmMeetingRepository.recordIcsCheck(first.id, {
        checkedAt: new Date(),
        error: 'falhou',
      })
      const noted = await prisma.crmMeetingAvailability.findUniqueOrThrow({
        where: { id: first.id },
      })
      expect(noted.icsLastError).toBe('falhou')
    })

    it('should swallow a failed ICS note', async () => {
      await expect(
        CrmMeetingRepository.recordIcsCheck('missing', {
          checkedAt: new Date(),
          error: null,
        }),
      ).resolves.toBeUndefined()
    })
  })

  describe('book()', () => {
    it('should create the booking, the agenda event and rotate the assignment', async () => {
      const { workspace, users, page } = await setup(2)

      const booking = expectOk(
        await CrmMeetingRepository.book(
          bookInput(workspace.id, page, [users[0].id, users[1].id]),
        ),
      )

      expect(booking.hostUserId).toBe(users[0].id)
      expect(booking.status).toBe('CONFIRMED')
      const event = await prisma.crmCalendarEvent.findUniqueOrThrow({
        where: { id: booking.calendarEventId as string },
      })
      expect(event.attendees).toEqual(['c@example.com'])
      const host = await prisma.crmMeetingHost.findFirstOrThrow({
        where: { pageId: page.id, userId: users[0].id },
      })
      expect(host.lastAssignedAt).not.toBeNull()
    })

    it('should fall through to the next seller when the first is busy', async () => {
      const { workspace, users, page } = await setup(2)
      expectOk(
        await CrmMeetingRepository.book(
          bookInput(workspace.id, page, [users[0].id]),
        ),
      )

      const second = expectOk(
        await CrmMeetingRepository.book(
          bookInput(workspace.id, page, [users[0].id, users[1].id]),
        ),
      )

      expect(second.hostUserId).toBe(users[1].id)
    })

    it('should answer slot taken when every candidate is busy, buffer included', async () => {
      const { workspace, users, page } = await setup(1)
      const buffered = { ...page, bufferMinutes: 15 }
      expectOk(
        await CrmMeetingRepository.book(
          bookInput(workspace.id, buffered, [users[0].id]),
        ),
      )

      // Starts 10 minutes after the first ends: inside the 15 min buffer.
      const clash = await CrmMeetingRepository.book(
        bookInput(workspace.id, buffered, [users[0].id], {
          startsAt: at('2026-11-10T13:40:00Z'),
          endsAt: at('2026-11-10T14:10:00Z'),
        }),
      )

      expectErr(clash, 'CRM_MEETING_SLOT_TAKEN')
    })

    it('should treat a calendar event of the seller as busy time', async () => {
      const { workspace, users, page } = await setup(1)
      await prisma.crmCalendarEvent.create({
        data: {
          workspaceId: workspace.id,
          createdById: users[0].id,
          title: 'Almoço',
          startsAt: at('2026-11-10T12:45:00Z'),
          endsAt: at('2026-11-10T13:15:00Z'),
        },
      })

      expectErr(
        await CrmMeetingRepository.book(
          bookInput(workspace.id, page, [users[0].id]),
        ),
        'CRM_MEETING_SLOT_TAKEN',
      )
    })

    it('should let only one of two simultaneous guests take the same seller', async () => {
      const { workspace, users, page } = await setup(1)

      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          CrmMeetingRepository.book(
            bookInput(workspace.id, page, [users[0].id]),
          ),
        ),
      )

      const won = results.filter((r) => r.ok)
      const lost = results.filter((r) => !r.ok)
      expect(won).toHaveLength(1)
      expect(lost).toHaveLength(5)
      for (const result of lost) {
        expect(result.ok === false && result.error.code).toBe(
          'CRM_MEETING_SLOT_TAKEN',
        )
      }
      expect(
        await prisma.crmMeetingBooking.count({
          where: { hostUserId: users[0].id, status: 'CONFIRMED' },
        }),
      ).toBe(1)
    })

    it('should spread simultaneous guests over the sellers, never double booking one', async () => {
      const { workspace, users, page } = await setup(2)
      const both = users.map((u) => u.id)

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          CrmMeetingRepository.book(bookInput(workspace.id, page, both)),
        ),
      )

      const won = results.flatMap((r) => (r.ok ? [r.value] : []))
      expect(won).toHaveLength(2)
      expect(new Set(won.map((b) => b.hostUserId)).size).toBe(2)
    })

    it('should return a database error when the transaction fails', async () => {
      const { workspace, users, page } = await setup(1)
      vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('boom'))

      expectErr(
        await CrmMeetingRepository.book(
          bookInput(workspace.id, page, [users[0].id]),
        ),
        'DATABASE_ERROR',
      )
    })
  })

  describe('bookings', () => {
    async function booked() {
      const ctx = await setup(1)
      const booking = expectOk(
        await CrmMeetingRepository.book(
          bookInput(ctx.workspace.id, ctx.page, [ctx.users[0].id], {
            token: 'manage-token',
          }),
        ),
      )
      return { ...ctx, booking }
    }

    it('should find a booking by token and by id inside its workspace', async () => {
      const { workspace, booking, page } = await booked()
      const other = await seedWorkspace()

      const byToken = expectOk(
        await CrmMeetingRepository.findBookingByToken('manage-token'),
      )
      expect(byToken?.page.workspace.name).toBe(workspace.name)
      expect(byToken?.page.id).toBe(page.id)
      expect(
        expectOk(
          await CrmMeetingRepository.findBookingByToken('unknown-token'),
        ),
      ).toBeNull()
      expect(
        expectOk(
          await CrmMeetingRepository.findBooking(workspace.id, booking.id),
        )?.id,
      ).toBe(booking.id)
      expect(
        expectOk(await CrmMeetingRepository.findBooking(other.id, booking.id)),
      ).toBeNull()
    })

    it('should cancel a booking and free its agenda slot', async () => {
      const { workspace, users, page, booking } = await booked()

      const canceled = expectOk(
        await CrmMeetingRepository.cancelBooking(booking.id, 'guest'),
      )

      expect(canceled.status).toBe('CANCELED')
      expect(canceled.canceledBy).toBe('guest')
      expect(
        await prisma.crmCalendarEvent.count({
          where: { id: booking.calendarEventId as string },
        }),
      ).toBe(0)
      expectOk(
        await CrmMeetingRepository.book(
          bookInput(workspace.id, page, [users[0].id]),
        ),
      )
    })

    it('should return a database error when canceling a missing booking', async () => {
      expectErr(
        await CrmMeetingRepository.cancelBooking('missing', 'host'),
        'DATABASE_ERROR',
      )
    })

    it('should count upcoming confirmed bookings per page', async () => {
      const { page, booking } = await booked()

      const counts = expectOk(
        await CrmMeetingRepository.countUpcomingByPage(
          [page.id],
          at('2026-11-01T00:00:00Z'),
        ),
      )
      expect(counts.get(page.id)).toBe(1)

      await CrmMeetingRepository.cancelBooking(booking.id, 'host')
      const after = expectOk(
        await CrmMeetingRepository.countUpcomingByPage(
          [page.id],
          at('2026-11-01T00:00:00Z'),
        ),
      )
      expect(after.get(page.id)).toBeUndefined()
    })

    it('should list bookings by scope and by host', async () => {
      const { workspace, users, booking } = await booked()
      const now = at('2026-11-10T00:00:00Z')
      const list = (
        scope: 'upcoming' | 'past' | 'all',
        hostUserId?: string,
        when = now,
      ) =>
        CrmMeetingRepository.listBookings(workspace.id, {
          scope,
          hostUserId,
          now: when,
        })

      expect(expectOk(await list('upcoming')).map((b) => b.id)).toEqual([
        booking.id,
      ])
      expect(expectOk(await list('past'))).toEqual([])
      expect(
        expectOk(await list('past', undefined, at('2026-12-01T00:00:00Z'))),
      ).toHaveLength(1)
      expect(expectOk(await list('all', users[0].id))).toHaveLength(1)
      expect(expectOk(await list('all', 'someone-else'))).toEqual([])
      expect(expectOk(await list('all'))[0].page.title).toBe('Conversa')
    })

    it('should report busy time of bookings and agenda events', async () => {
      const { workspace, users, booking } = await booked()
      await prisma.crmCalendarEvent.create({
        data: {
          workspaceId: workspace.id,
          createdById: users[0].id,
          title: 'Outro',
          startsAt: at('2026-11-10T15:00:00Z'),
          endsAt: at('2026-11-10T16:00:00Z'),
        },
      })

      const busy = expectOk(
        await CrmMeetingRepository.busyOf(
          workspace.id,
          [users[0].id, 'idle'],
          at('2026-11-10T00:00:00Z'),
          at('2026-11-11T00:00:00Z'),
        ),
      )

      // The booking and the agenda event it created, plus the other event.
      expect(busy.get(users[0].id)).toHaveLength(3)
      expect(busy.get('idle')).toEqual([])
      await CrmMeetingRepository.cancelBooking(booking.id, 'host')
      const after = expectOk(
        await CrmMeetingRepository.busyOf(
          workspace.id,
          [users[0].id],
          at('2026-11-10T00:00:00Z'),
          at('2026-11-11T00:00:00Z'),
        ),
      )
      expect(after.get(users[0].id)).toHaveLength(1)
    })

    it('should attach the lead and link the agenda event to the person', async () => {
      const { workspace, users, booking } = await booked()
      const person = await prisma.crmPerson.create({
        data: {
          name: 'Cliente',
          workspaceId: workspace.id,
          createdById: users[0].id,
        },
      })

      await CrmMeetingRepository.attachLead(
        booking.id,
        'lead-1',
        booking.calendarEventId,
        person.id,
      )

      const row = await prisma.crmMeetingBooking.findUniqueOrThrow({
        where: { id: booking.id },
      })
      expect(row.leadId).toBe('lead-1')
      const event = await prisma.crmCalendarEvent.findUniqueOrThrow({
        where: { id: booking.calendarEventId as string },
      })
      expect(event.personId).toBe(person.id)
    })

    it('should swallow failures while attaching the lead', async () => {
      await expect(
        CrmMeetingRepository.attachLead('missing', 'lead', null, null),
      ).resolves.toBeUndefined()
    })

    it('should mark the confirmation as sent and ignore a missing booking', async () => {
      const { booking } = await booked()

      await CrmMeetingRepository.markConfirmationSent(booking.id)
      await CrmMeetingRepository.markConfirmationSent('missing')

      const row = await prisma.crmMeetingBooking.findUniqueOrThrow({
        where: { id: booking.id },
      })
      expect(row.confirmationSentAt).not.toBeNull()
    })
  })

  describe('reminders', () => {
    it('should list bookings inside the reminder window and claim each once', async () => {
      const { workspace, users, page } = await setup(2)
      const soon = expectOk(
        await CrmMeetingRepository.book(
          bookInput(workspace.id, page, [users[0].id], {
            startsAt: at('2026-11-10T13:00:00Z'),
            endsAt: at('2026-11-10T13:30:00Z'),
          }),
        ),
      )
      // 3 h out: not due yet with a 60 minute window.
      expectOk(
        await CrmMeetingRepository.book(
          bookInput(workspace.id, page, [users[1].id], {
            startsAt: at('2026-11-10T15:00:00Z'),
            endsAt: at('2026-11-10T15:30:00Z'),
          }),
        ),
      )
      const now = at('2026-11-10T12:10:00Z')

      const due = expectOk(await CrmMeetingRepository.dueReminders(now, 10))

      expect(due.map((b) => b.id)).toEqual([soon.id])
      expect(due[0].page.workspace.name).toBe(workspace.name)
      expect(await CrmMeetingRepository.claimReminder(soon.id)).toBe(true)
      expect(await CrmMeetingRepository.claimReminder(soon.id)).toBe(false)
      expect(
        expectOk(await CrmMeetingRepository.dueReminders(now, 10)),
      ).toEqual([])
    })

    it('should cap the batch and skip canceled bookings and pages without reminder', async () => {
      const { workspace, users, page } = await setup(1)
      const first = expectOk(
        await CrmMeetingRepository.book(
          bookInput(workspace.id, page, [users[0].id]),
        ),
      )
      expectOk(await CrmMeetingRepository.cancelBooking(first.id, 'host'))
      expectOk(
        await CrmMeetingRepository.book(
          bookInput(workspace.id, page, [users[0].id], {
            startsAt: at('2026-11-10T13:00:00Z'),
            endsAt: at('2026-11-10T13:30:00Z'),
          }),
        ),
      )
      const now = at('2026-11-10T12:30:00Z')

      expect(
        expectOk(await CrmMeetingRepository.dueReminders(now, 10)),
      ).toHaveLength(1)
      expect(expectOk(await CrmMeetingRepository.dueReminders(now, 0))).toEqual(
        [],
      )
      await prisma.crmMeetingPage.update({
        where: { id: page.id },
        data: { reminderMinutes: 0 },
      })
      expect(
        expectOk(await CrmMeetingRepository.dueReminders(now, 10)),
      ).toEqual([])
    })

    it('should not claim a missing booking', async () => {
      expect(await CrmMeetingRepository.claimReminder('missing')).toBe(false)
    })
  })

  describe('database failures', () => {
    it('should wrap every read in a database error', async () => {
      const boom = () => new Error('boom')
      vi.spyOn(prisma.crmMeetingPage, 'create').mockRejectedValue(boom())
      vi.spyOn(prisma, '$transaction').mockRejectedValue(boom())
      vi.spyOn(prisma.crmMeetingPage, 'update').mockRejectedValue(boom())
      vi.spyOn(prisma.crmMeetingPage, 'findMany').mockRejectedValue(boom())
      vi.spyOn(prisma.crmMeetingPage, 'findFirst').mockRejectedValue(boom())
      vi.spyOn(prisma.crmMeetingPage, 'findUnique').mockRejectedValue(boom())
      vi.spyOn(prisma.crmMeetingPage, 'count').mockRejectedValue(boom())
      vi.spyOn(prisma.crmMeetingBooking, 'groupBy').mockRejectedValue(boom())
      vi.spyOn(prisma.crmMeetingBooking, 'findMany').mockRejectedValue(boom())
      vi.spyOn(prisma.crmMeetingBooking, 'findUnique').mockRejectedValue(boom())
      vi.spyOn(prisma.crmMeetingBooking, 'findFirst').mockRejectedValue(boom())
      vi.spyOn(prisma.crmMeetingAvailability, 'findUnique').mockRejectedValue(
        boom(),
      )
      vi.spyOn(prisma.crmMeetingAvailability, 'findMany').mockRejectedValue(
        boom(),
      )
      vi.spyOn(prisma.crmMeetingAvailability, 'upsert').mockRejectedValue(
        boom(),
      )
      vi.spyOn(prisma.membership, 'findMany').mockRejectedValue(boom())

      const results = await Promise.all([
        CrmMeetingRepository.createPage('w', 'u', fields('x'), []),
        CrmMeetingRepository.updatePage('p', {}, ['u']),
        CrmMeetingRepository.softDeletePage('p'),
        CrmMeetingRepository.listPages('w'),
        CrmMeetingRepository.findPage('w', 'p'),
        CrmMeetingRepository.findPageBySlug('s'),
        CrmMeetingRepository.findPageWithWorkspace('p'),
        CrmMeetingRepository.slugExists('s'),
        CrmMeetingRepository.countUpcomingByPage(['p'], new Date()),
        CrmMeetingRepository.membersByIds('w', ['u']),
        CrmMeetingRepository.getAvailability('w', 'u'),
        CrmMeetingRepository.availabilityOf('w', ['u']),
        CrmMeetingRepository.upsertAvailability('w', 'u', {
          timezone: 'UTC',
          weeklyHours: {},
          icsUrlEnc: null,
          icsCheckedAt: null,
          icsLastError: null,
        }),
        CrmMeetingRepository.busyOf('w', ['u'], new Date(), new Date()),
        CrmMeetingRepository.findBookingByToken('t'),
        CrmMeetingRepository.findBooking('w', 'b'),
        CrmMeetingRepository.cancelBooking('b', 'host'),
        CrmMeetingRepository.listBookings('w', {
          scope: 'all',
          now: new Date(),
        }),
        CrmMeetingRepository.dueReminders(new Date(), 5),
      ])

      for (const result of results) expectErr(result, 'DATABASE_ERROR')
    })

    it('should treat a failed reminder claim as not claimed', async () => {
      vi.spyOn(prisma.crmMeetingBooking, 'updateMany').mockRejectedValue(
        new Error('boom'),
      )

      expect(await CrmMeetingRepository.claimReminder('b')).toBe(false)
    })
  })
})
