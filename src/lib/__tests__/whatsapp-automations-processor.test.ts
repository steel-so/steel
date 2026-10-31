import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  schedulingTick: vi.fn(),
}))

vi.mock('@/lib/axiom/logger', () => ({ logger: mocks.loggerMock }))
vi.mock('@/src/services/whatsapp-scheduling.service', () => ({
  WhatsAppSchedulingService: { tick: mocks.schedulingTick },
}))

import { QueueName, WhatsappAutomationsJob } from '@/src/lib/queue/jobs'
import { processWhatsappAutomations } from '@/src/lib/queue/processors/whatsapp-automations'
import { WhatsappAutomationsCron } from '@/src/lib/queue/retention'

function job(name: string, id: string | null = 'job-1'): Job {
  return { id: id ?? undefined, name, data: {} } as unknown as Job
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('processWhatsappAutomations', () => {
  it('registers its own queue and runs every minute', () => {
    expect(QueueName.WhatsappAutomations).toBe('whatsapp-automations')
    expect(WhatsappAutomationsCron).toBe('* * * * *')
  })

  it('stays quiet on idle ticks', async () => {
    mocks.schedulingTick.mockResolvedValue({
      ok: true,
      value: { confirmations: 0, reminders: 0, failed: 0 },
    })
    await processWhatsappAutomations(job(WhatsappAutomationsJob.SchedulingTick))
    expect(mocks.loggerMock.info).not.toHaveBeenCalled()
  })

  it('runs the scheduling tick and logs its work', async () => {
    const tally = { confirmations: 1, reminders: 2, failed: 0 }
    mocks.schedulingTick.mockResolvedValue({ ok: true, value: tally })
    expect(
      await processWhatsappAutomations(
        job(WhatsappAutomationsJob.SchedulingTick),
      ),
    ).toEqual(tally)
    expect(mocks.loggerMock.info).toHaveBeenCalledWith(
      'queue.whatsapp_automations.scheduling_tick_completed',
      expect.objectContaining({ reminders: 2 }),
    )
  })

  it('throws so BullMQ retries when a tick fails', async () => {
    const error = { code: 'DATABASE_ERROR', message: 'down' }
    mocks.schedulingTick.mockResolvedValue({ ok: false, error })
    await expect(
      processWhatsappAutomations(job(WhatsappAutomationsJob.SchedulingTick)),
    ).rejects.toThrow(
      'Failed to run appointment messages: DATABASE_ERROR (down)',
    )
  })

  it('rejects an unknown job name', async () => {
    await expect(processWhatsappAutomations(job('nope', null))).rejects.toThrow(
      'Unknown whatsapp-automations job: nope (id=unknown)',
    )
  })
})
