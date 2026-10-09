import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  info: vi.fn(),
}))

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: mocks.info, warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/queue/queues', () => ({
  getCrmWorkflowDelayQueue: () => ({ add: mocks.add }),
}))

import { enqueueCrmWorkflowResume } from '@/src/lib/queue/crm-workflow-delay'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('enqueueCrmWorkflowResume()', () => {
  it('should add a delayed resume job and log it', async () => {
    mocks.add.mockResolvedValue({ id: 'job-9' })

    const id = await enqueueCrmWorkflowResume(
      { runId: 'run-1', stepId: 'step-1' },
      3_600_000,
    )

    expect(id).toBe('job-9')
    expect(mocks.add).toHaveBeenCalledWith(
      'resume',
      { runId: 'run-1', stepId: 'step-1' },
      { delay: 3_600_000 },
    )
    expect(mocks.info).toHaveBeenCalledWith(
      'queue.crm_workflow_delay.enqueued',
      expect.objectContaining({ runId: 'run-1', delayMs: 3_600_000 }),
    )
  })

  it('should never pass a negative delay and tolerate a job without id', async () => {
    mocks.add.mockResolvedValue({})

    expect(
      await enqueueCrmWorkflowResume({ runId: 'r', stepId: 's' }, -5),
    ).toBe('')
    expect(mocks.add).toHaveBeenCalledWith('resume', expect.anything(), {
      delay: 0,
    })
  })
})
