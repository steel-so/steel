import type { Job } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'

const { tick, loggerMock } = vi.hoisted(() => ({
  tick: vi.fn(),
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/src/services/crm-meeting-reminder.service', () => ({
  CrmMeetingReminderService: { tick },
}))
vi.mock('@/lib/axiom/logger', () => ({ logger: loggerMock }))

import { CrmMeetingsJob } from '@/src/lib/queue/jobs'
import { processCrmMeetings } from '@/src/lib/queue/processors/crm-meetings'

const job = (name: string, id: string | null = 'job-1') =>
  ({ id, name, data: {} }) as unknown as Job

describe('processCrmMeetings', () => {
  it('sends the due reminders and logs when there was work', async () => {
    tick.mockResolvedValue({ ok: true, value: { due: 2, sent: 2 } })

    const result = await processCrmMeetings(job(CrmMeetingsJob.RunReminders))

    expect(result).toEqual({ due: 2, sent: 2 })
    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.crm_meetings.reminders_completed',
      expect.objectContaining({ jobId: 'job-1', due: 2, sent: 2 }),
    )
  })

  it('stays quiet on an idle tick', async () => {
    loggerMock.info.mockClear()
    tick.mockResolvedValue({ ok: true, value: { due: 0, sent: 0 } })

    await processCrmMeetings(job(CrmMeetingsJob.RunReminders))

    expect(loggerMock.info).not.toHaveBeenCalled()
  })

  it('throws so BullMQ retries when the tick fails', async () => {
    tick.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'down' },
    })

    await expect(
      processCrmMeetings(job(CrmMeetingsJob.RunReminders)),
    ).rejects.toThrow('DATABASE_ERROR')
  })

  it('rejects unknown job names', async () => {
    await expect(processCrmMeetings(job('nope'))).rejects.toThrow(
      'Unknown crm-meetings job: nope (id=job-1)',
    )
    await expect(processCrmMeetings(job('nope', null))).rejects.toThrow(
      'id=unknown',
    )
  })
})
