import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

const mocks = vi.hoisted(() => ({
  process: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/axiom/logger', () => ({ logger: mocks.logger }))
vi.mock('@/src/services/phone-call-ai.service', () => ({
  PhoneCallAiService: { process: mocks.process },
}))

import { processPhoneCallAi } from '../queue/processors/phone-call-ai'

function job(name = 'process-recording', id: string | null = 'j1') {
  return { name, id, data: { callId: 'call1' } } as Job
}

beforeEach(() => vi.clearAllMocks())

describe('processPhoneCallAi()', () => {
  it('logs a processed call', async () => {
    mocks.process.mockResolvedValue(
      ok({
        status: 'done',
        callId: 'call1',
        workspaceId: 'ws1',
        summarized: true,
        links: { sdTicketId: 't1', crmPersonId: null, crmOpportunityId: null },
      }),
    )
    await processPhoneCallAi(job())
    expect(mocks.process).toHaveBeenCalledWith('call1')
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'queue.phone_call_ai.done',
      expect.objectContaining({ workspaceId: 'ws1', sdTicketId: 't1' }),
    )
  })

  it('warns on missing resources and informs on other skips', async () => {
    mocks.process.mockResolvedValueOnce(
      ok({ status: 'skipped', reason: 'ai_quota_exceeded' }),
    )
    await processPhoneCallAi(job())
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'queue.phone_call_ai.skipped',
      expect.objectContaining({ reason: 'ai_quota_exceeded' }),
    )

    mocks.process.mockResolvedValueOnce(
      ok({ status: 'skipped', reason: 'transcription_disabled' }),
    )
    await processPhoneCallAi(job())
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'queue.phone_call_ai.skipped',
      expect.objectContaining({ reason: 'transcription_disabled' }),
    )
  })

  it('logs ignored calls and failed transcriptions without throwing', async () => {
    mocks.process.mockResolvedValueOnce(
      ok({ status: 'ignored', reason: 'not_pending' }),
    )
    await processPhoneCallAi(job())
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'queue.phone_call_ai.ignored',
      expect.objectContaining({ reason: 'not_pending' }),
    )

    mocks.process.mockResolvedValueOnce(
      ok({ status: 'failed', reason: 'transcription_failed', detail: 'down' }),
    )
    await processPhoneCallAi(job())
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'queue.phone_call_ai.failed',
      expect.objectContaining({ message: 'down' }),
    )
  })

  it('throws on a database failure so BullMQ retries', async () => {
    mocks.process.mockResolvedValue(err(databaseError('db down')))
    await expect(processPhoneCallAi(job())).rejects.toThrow('DATABASE_ERROR')
  })

  it('throws on an unknown job name', async () => {
    await expect(processPhoneCallAi(job('bogus', null))).rejects.toThrow(
      'Unknown phone-call-ai job: bogus (id=unknown)',
    )
  })
})
