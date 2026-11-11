import { describe, expect, it, vi } from 'vitest'
import { clearFinishedJob } from '@/src/lib/queue/processors/clear-finished-job'

function job(state: 'waiting' | 'completed' | 'failed') {
  return {
    isCompleted: vi.fn(async () => state === 'completed'),
    isFailed: vi.fn(async () => state === 'failed'),
    remove: vi.fn(async () => undefined),
  }
}

describe('clearFinishedJob', () => {
  it('removes a completed or failed job so the fixed id can run again', async () => {
    for (const state of ['completed', 'failed'] as const) {
      const found = job(state)
      const queue = { getJob: vi.fn(async () => found) }
      await clearFinishedJob(queue, 'fixed-id')
      expect(queue.getJob).toHaveBeenCalledWith('fixed-id')
      expect(found.remove).toHaveBeenCalledTimes(1)
    }
  })

  it('keeps a job still waiting or running, and ignores a missing one', async () => {
    const waiting = job('waiting')
    await clearFinishedJob({ getJob: async () => waiting }, 'fixed-id')
    expect(waiting.remove).not.toHaveBeenCalled()

    await expect(
      clearFinishedJob({ getJob: async () => undefined }, 'fixed-id'),
    ).resolves.toBeUndefined()
  })
})
