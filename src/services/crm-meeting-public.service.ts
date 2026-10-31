import { randomBytes } from 'node:crypto'
import type { CrmMeetingBooking } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { baseEmailUrl } from '@/lib/base-email-url'
import {
  crmMeetingBookingNotFound,
  crmMeetingInvalid,
  crmMeetingPageNotFound,
  crmMeetingSlotTaken,
} from '@/src/errors'
import { buildInvite } from '@/src/lib/crm-meetings/ics'
import { sendCrmMeetingEmail } from '@/src/lib/mail/crm/send-meeting-booking'
import { err, ok, type Result } from '@/src/lib/result'
import { toPublicMeetingBookingDTO } from '@/src/mappers/crm-meeting.mapper'
import { CrmActivityRepository } from '@/src/repositories/crm-activity.repository'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import {
  CrmMeetingRepository,
  type MeetingPageWithHosts,
} from '@/src/repositories/crm-meeting.repository'
import type {
  BookCrmMeetingDTO,
  PublicSlotsQueryDTO,
} from '@/src/schemas/crm-meeting.schema'
import type {
  PublicMeetingBookingDTO,
  PublicMeetingPageDTO,
  PublicMeetingSlotsDTO,
} from '@/types/crm-meeting'
import { assertModuleEnabled } from './authz'
import { CrmLeadService } from './crm-lead.service'
import { freeHostsAt, planPageSlots } from './crm-meeting-slots'
import { emitNotification } from './notification-emitter'

/**
 * Public side of the meeting pages (C5): everything here runs without a
 * session, so every entry point re-checks that the page is live and that the
 * workspace still has the CRM module on.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export const meetingPublicPath = (slug: string) => `/m/${slug}`
export const meetingManageUrl = (token: string) =>
  `${baseEmailUrl}/m/b/${token}`

type LivePage = MeetingPageWithHosts & { workspace: { name: string } }

async function livePage(slug: string): Promise<Result<LivePage>> {
  const found = await CrmMeetingRepository.findPageBySlug(slug)
  if (!found.ok) return found
  if (!found.value?.active) return err(crmMeetingPageNotFound())
  const enabled = await assertModuleEnabled(found.value.workspaceId, 'CRM')
  if (!enabled.ok) return err(crmMeetingPageNotFound())
  return ok(found.value)
}

/** "sex., 6 de nov. às 14:30" in the guest's zone. */
export function whenLabel(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

async function hostIdentity(workspaceId: string, userId: string) {
  const members = await CrmMeetingRepository.membersByIds(workspaceId, [userId])
  const user = members.ok ? members.value[0] : undefined
  return {
    name: user?.name ?? 'Equipe',
    email: user?.email ?? 'no-reply@steel.app',
  }
}

export interface BookingMailContext {
  booking: CrmMeetingBooking
  page: {
    title: string
    location: string | null
    format: 'IN_PERSON' | 'ONLINE'
    workspace: { name: string }
  }
}

async function sendMail(
  kind: 'confirmation' | 'reminder' | 'canceled',
  booking: CrmMeetingBooking,
  page: BookingMailContext['page'] & { workspaceId?: string },
): Promise<boolean> {
  try {
    const host = await hostIdentity(booking.workspaceId, booking.hostUserId)
    const invite =
      kind === 'reminder'
        ? undefined
        : buildInvite({
            uid: `${booking.id}@steel`,
            start: booking.startsAt,
            end: booking.endsAt,
            title: `${page.title} — ${host.name}`,
            description: page.workspace.name,
            location: page.location,
            organizerEmail: host.email,
            organizerName: host.name,
            attendeeEmail: booking.guestEmail,
            attendeeName: booking.guestName,
            method: kind === 'canceled' ? 'CANCEL' : 'REQUEST',
            sequence: kind === 'canceled' ? 1 : 0,
          })
    await sendCrmMeetingEmail(
      {
        email: booking.guestEmail,
        username: booking.guestName,
        kind,
        workspaceName: page.workspace.name,
        pageTitle: page.title,
        hostName: host.name,
        whenLabel: whenLabel(booking.startsAt, booking.guestTimezone),
        timezone: booking.guestTimezone,
        location: page.location,
        manageUrl: meetingManageUrl(booking.manageToken),
      },
      { ics: invite, idempotencyKey: `crm-meeting:${kind}:${booking.id}` },
    )
    return true
  } catch (error) {
    logger.warn('crm.meetings.email_failed', {
      bookingId: booking.id,
      kind,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/** Reminder e-mail of one booking (used by the worker). */
export async function sendMeetingReminder(
  booking: CrmMeetingBooking,
  page: BookingMailContext['page'],
): Promise<boolean> {
  return sendMail('reminder', booking, page)
}

async function createLeadAndActivity(
  booking: CrmMeetingBooking,
  page: MeetingPageWithHosts,
  dto: BookCrmMeetingDTO,
): Promise<void> {
  try {
    const intake = await CrmLeadService.intake(
      booking.workspaceId,
      {
        kind: 'system',
        createdById: page.createdById,
        via: 'meeting',
        refId: booking.id,
      },
      {
        name: dto.name,
        emails: [dto.email],
        phones: dto.phone ? [dto.phone] : [],
        source: page.leadSource,
        channel: 'Agendamento',
      },
    )
    if (!intake.ok) {
      logger.warn('crm.meetings.lead_failed', {
        bookingId: booking.id,
        code: intake.error.code,
      })
      return
    }
    const lead = intake.value.lead
    if (!lead.ownerId) {
      await CrmLeadRepository.update(lead.id, {
        ownerId: booking.hostUserId,
        updatedById: booking.hostUserId,
      })
    }
    await CrmLeadRepository.createMeeting({
      leadId: lead.id,
      workspaceId: booking.workspaceId,
      createdById: booking.hostUserId,
      scheduledAt: booking.startsAt,
      format: page.format,
      contactPersonName: dto.name,
      interestDetails:
        dto.notes?.trim() || `Agendou pela página "${page.title}"`,
      identifiedNeed: 'A definir na reunião',
    })
    await CrmActivityRepository.record({
      workspaceId: booking.workspaceId,
      actorUserId: booking.hostUserId,
      action: 'MEETING_BOOKED',
      entity: 'lead',
      entityId: lead.id,
      summary: `${dto.name} agendou "${page.title}" para ${whenLabel(booking.startsAt, page.timezone)}`,
    })
    await CrmMeetingRepository.attachLead(
      booking.id,
      lead.id,
      booking.calendarEventId,
      null,
    )
  } catch (error) {
    logger.warn('crm.meetings.lead_failed', {
      bookingId: booking.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function cancelBookingAndNotify(
  booking: CrmMeetingBooking,
  by: 'guest' | 'host',
): Promise<Result<CrmMeetingBooking>> {
  if (booking.status === 'CANCELED') return ok(booking)
  const page = await CrmMeetingRepository.findPageWithWorkspace(booking.pageId)
  const canceled = await CrmMeetingRepository.cancelBooking(booking.id, by)
  if (!canceled.ok) return canceled
  if (page.ok && page.value) {
    await sendMail('canceled', canceled.value, page.value)
    if (by === 'guest') {
      void emitNotification({
        workspaceId: booking.workspaceId,
        recipients: [booking.hostUserId],
        kind: 'CRM_MEETING_BOOKED',
        title: `Reunião cancelada: ${booking.guestName}`,
        body: `${booking.guestName} cancelou "${page.value.title}" de ${whenLabel(booking.startsAt, page.value.timezone)}.`,
        path: '/crm/meetings',
        dedupeKey: `crm-meeting-canceled:${booking.id}`,
      })
    }
  }
  return canceled
}

export const CrmMeetingPublicService = {
  async getPage(slug: string): Promise<Result<PublicMeetingPageDTO>> {
    const page = await livePage(slug)
    if (!page.ok) return page
    return ok({
      slug: page.value.slug,
      title: page.value.title,
      description: page.value.description,
      durationMinutes: page.value.durationMinutes,
      timezone: page.value.timezone,
      format: page.value.format,
      workspaceName: page.value.workspace.name,
    })
  },

  async listSlots(
    slug: string,
    query: PublicSlotsQueryDTO,
    now = new Date(),
  ): Promise<Result<PublicMeetingSlotsDTO>> {
    const page = await livePage(slug)
    if (!page.ok) return page
    const from = query.from ? new Date(query.from) : now
    const to = new Date(from.getTime() + query.days * DAY_MS)
    const plan = await planPageSlots(page.value, from, to, now)
    if (!plan.ok) return plan
    const slots = [...plan.value.slots.keys()]
      .sort((a, b) => a - b)
      .map((ms) => new Date(ms).toISOString())
    return ok({
      timezone: page.value.timezone,
      durationMinutes: page.value.durationMinutes,
      slots,
    })
  },

  async book(
    slug: string,
    dto: BookCrmMeetingDTO,
    now = new Date(),
  ): Promise<Result<PublicMeetingBookingDTO>> {
    const page = await livePage(slug)
    if (!page.ok) return page
    const startsAt = new Date(dto.startsAt)
    const endsAt = new Date(
      startsAt.getTime() + page.value.durationMinutes * 60000,
    )

    const hosts = await freeHostsAt(page.value, startsAt, now)
    if (!hosts.ok) return hosts
    if (hosts.value.length === 0) return err(crmMeetingSlotTaken())

    const booked = await CrmMeetingRepository.book({
      workspaceId: page.value.workspaceId,
      page: page.value,
      candidates: hosts.value,
      startsAt,
      endsAt,
      guest: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone ?? null,
        notes: dto.notes ?? null,
        timezone: dto.timezone,
      },
      manageToken: randomBytes(24).toString('base64url'),
    })
    if (!booked.ok) return booked
    const booking = booked.value

    auditMutation({
      entity: 'crm_meeting_booking',
      action: 'create',
      actorId: null,
      targetId: booking.id,
      meta: {
        workspaceId: booking.workspaceId,
        pageId: page.value.id,
        hostUserId: booking.hostUserId,
      },
    })

    await createLeadAndActivity(booking, page.value, dto)
    if (await sendMail('confirmation', booking, page.value)) {
      void CrmMeetingRepository.markConfirmationSent(booking.id)
    }
    void emitNotification({
      workspaceId: booking.workspaceId,
      recipients: [booking.hostUserId],
      kind: 'CRM_MEETING_BOOKED',
      title: `Reunião agendada: ${dto.name}`,
      body: `${dto.name} reservou "${page.value.title}" para ${whenLabel(startsAt, page.value.timezone)}.`,
      path: '/crm/meetings',
      dedupeKey: `crm-meeting-booked:${booking.id}`,
    })

    const host = await hostIdentity(booking.workspaceId, booking.hostUserId)
    return ok(toPublicMeetingBookingDTO(booking, page.value, host.name))
  },

  async getBooking(token: string): Promise<Result<PublicMeetingBookingDTO>> {
    const found = await CrmMeetingRepository.findBookingByToken(token)
    if (!found.ok) return found
    if (!found.value) return err(crmMeetingBookingNotFound())
    const host = await hostIdentity(
      found.value.workspaceId,
      found.value.hostUserId,
    )
    return ok(
      toPublicMeetingBookingDTO(found.value, found.value.page, host.name),
    )
  },

  async cancel(
    token: string,
    now = new Date(),
  ): Promise<Result<PublicMeetingBookingDTO>> {
    const found = await CrmMeetingRepository.findBookingByToken(token)
    if (!found.ok) return found
    if (!found.value) return err(crmMeetingBookingNotFound())
    if (
      found.value.status === 'CONFIRMED' &&
      found.value.startsAt.getTime() <= now.getTime()
    ) {
      return err(
        crmMeetingInvalid(
          'Essa reunião já começou e não pode mais ser cancelada',
        ),
      )
    }
    const canceled = await cancelBookingAndNotify(found.value, 'guest')
    if (!canceled.ok) return canceled
    auditMutation({
      entity: 'crm_meeting_booking',
      action: 'cancel',
      actorId: null,
      targetId: found.value.id,
      meta: { workspaceId: found.value.workspaceId, by: 'guest' },
    })
    const host = await hostIdentity(
      found.value.workspaceId,
      found.value.hostUserId,
    )
    return ok(
      toPublicMeetingBookingDTO(canceled.value, found.value.page, host.name),
    )
  },
}
