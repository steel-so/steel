import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import {
  CrmMeetingReminderService,
  type MeetingReminderTick,
} from '@/src/services/crm-meeting-reminder.service'
import { CrmMeetingsJob } from '../jobs'

export async function processCrmMeetings(
  job: Job,
): Promise<MeetingReminderTick> {
  switch (job.name) {
    case CrmMeetingsJob.RunReminders: {
      const result = await CrmMeetingReminderService.tick()
      if (!result.ok) {
        throw new Error(
          `Failed to send meeting reminders: ${result.error.code} (${result.error.message})`,
        )
      }
      if (result.value.due > 0) {
        logger.info('queue.crm_meetings.reminders_completed', {
          component: 'Worker',
          jobId: job.id,
          ...result.value,
        })
      }
      return result.value
    }
    default:
      throw new Error(
        `Unknown crm-meetings job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
