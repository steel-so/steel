import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

const { executeAiEvalRun, loggerMock } = vi.hoisted(() => ({
  executeAiEvalRun: vi.fn(),
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/src/services/ai-eval-runner', () => ({ executeAiEvalRun }))
vi.mock('@/lib/axiom/logger', () => ({ logger: loggerMock }))

import { AiEvalJob } from '@/src/lib/queue/jobs'
import { processAiEval } from '@/src/lib/queue/processors/ai-eval'

function fakeJob(name: string, data: unknown, id?: string): Job {
  return { id, name, data } as unknown as Job
}

beforeEach(() => vi.clearAllMocks())

describe('processAiEval', () => {
  it('runs the eval and logs the outcome', async () => {
    executeAiEvalRun.mockResolvedValueOnce(
      ok({ status: 'done', passed: 2, failed: 0 }),
    )
    await expect(
      processAiEval(fakeJob(AiEvalJob.Run, { runId: 'r1' }, 'j1')),
    ).resolves.toEqual({ status: 'done', passed: 2, failed: 0 })
    expect(executeAiEvalRun).toHaveBeenCalledWith('r1')
    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.ai_eval.run_completed',
      expect.anything(),
    )
  })

  it('throws when the run fails at the infrastructure level', async () => {
    executeAiEvalRun.mockResolvedValueOnce(err(databaseError('db down')))
    await expect(
      processAiEval(fakeJob(AiEvalJob.Run, { runId: 'r1' })),
    ).rejects.toThrow('ai-eval run r1 failed: DATABASE_ERROR db down')
  })

  it('rejects unknown jobs', async () => {
    await expect(processAiEval(fakeJob('nope', {}, 'j9'))).rejects.toThrow(
      'Unknown ai-eval job: nope (id=j9)',
    )
    await expect(processAiEval(fakeJob('nope', {}))).rejects.toThrow(
      '(id=unknown)',
    )
  })
})
