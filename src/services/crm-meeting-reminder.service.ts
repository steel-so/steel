import { logger } from '@/lib/axiom/logger'
import { ok, type Result } from '@/src/lib/result'
import { CrmMeetingRepository } from '@/src/repositories/crm-meeting.repository'
import { sendMeetingReminder } from './crm-meeting-public.service'

const BATCH = 100

export interface MeetingReminderTick {
  due: number
  sent: number
}

export const CrmMeetingReminderService = {
  /** Sends the reminder of every booking that entered its reminder window. */
  async tick(now = new Date()): Promise<Result<MeetingReminderTick>> {
    const due = await CrmMeetingRepository.dueReminders(now, BATCH)
    if (!due.ok) return due
    let sent = 0
    for (const booking of due.value) {
      // Claim first: a second worker (or a retry) never mails twice.
      if (!(await CrmMeetingRepository.claimReminder(booking.id))) continue
      const delivered = await sendMeetingReminder(booking, booking.page)
      if (delivered) sent += 1
      else {
        logger.warn('crm.meetings.reminder_failed', { bookingId: booking.id })
      }
    }
    return ok({ due: due.value.length, sent })
  },
}
