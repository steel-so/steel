import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  syncAll: vi.fn(),
  info: vi.fn(),
}))

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: mocks.info, warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/services/crm-google-sync.service', () => ({
  CrmGoogleSyncService: { syncAll: mocks.syncAll },
}))

import { CrmGoogleSyncJob } from '@/src/lib/queue/jobs'
import { processCrmGoogleSync } from '@/src/lib/queue/processors/crm-google-sync'

function fakeJob(name: string, id: string | null = 'job-1'): Job {
  return { id: id ?? undefined, name, data: {} } as unknown as Job
}

beforeEach(() => vi.clearAllMocks())

describe('processCrmGoogleSync', () => {
  it('syncs every connected workspace and returns the counters', async () => {
    mocks.syncAll.mockResolvedValue({ processed: 3, synced: 2, failed: 1 })

    const result = await processCrmGoogleSync(fakeJob(CrmGoogleSyncJob.RunTick))

    expect(result).toEqual({ processed: 3, synced: 2, failed: 1 })
    expect(mocks.info).toHaveBeenCalledWith(
      'queue.crm_google_sync.tick_completed',
      expect.objectContaining({ processed: 3, synced: 2, failed: 1 }),
    )
  })

  it('throws on an unknown job name', async () => {
    await expect(processCrmGoogleSync(fakeJob('other', null))).rejects.toThrow(
      'Unknown crm-google-sync job: other (id=unknown)',
    )
    expect(mocks.syncAll).not.toHaveBeenCalled()
  })
})
