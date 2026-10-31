import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  renewalTick: vi.fn(),
}))

vi.mock('@/lib/axiom/logger', () => ({ logger: mocks.loggerMock }))
vi.mock('@/src/services/crm-contract.service', () => ({
  CrmContractService: { renewalTick: mocks.renewalTick },
}))

import { CrmDealsJob, QueueName } from '@/src/lib/queue/jobs'
import { processCrmDeals } from '@/src/lib/queue/processors/crm-deals'
import { CrmDealsCron } from '@/src/lib/queue/retention'

function job(name: string, data: unknown = {}, id: string | null = 'job-1') {
  return { id: id ?? undefined, name, data } as unknown as Job
}

const tally = {
  workspaces: 2,
  expired: 1,
  rolled: 0,
  alerted: 3,
  renewalsCreated: 2,
  errors: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('processCrmDeals', () => {
  it('registers its own queue and runs daily', () => {
    expect(QueueName.CrmDeals).toBe('crm-deals')
    expect(CrmDealsCron).toBe('30 6 * * *')
  })

  it('runs the renewal scan and logs the tally', async () => {
    mocks.renewalTick.mockResolvedValue({ ok: true, value: tally })

    expect(await processCrmDeals(job(CrmDealsJob.RenewalScan))).toEqual(tally)
    expect(mocks.renewalTick).toHaveBeenCalledWith({ workspaceId: undefined })
    expect(mocks.loggerMock.info).toHaveBeenCalledWith(
      'queue.crm_deals.renewal_scan_completed',
      expect.objectContaining({ component: 'Worker', alerted: 3 }),
    )
  })

  it('scopes to one workspace when the payload asks', async () => {
    mocks.renewalTick.mockResolvedValue({ ok: true, value: tally })
    await processCrmDeals(job(CrmDealsJob.RenewalScan, { workspaceId: 'ws1' }))
    expect(mocks.renewalTick).toHaveBeenCalledWith({ workspaceId: 'ws1' })
  })

  it('tolerates a job without data', async () => {
    mocks.renewalTick.mockResolvedValue({ ok: true, value: tally })
    await processCrmDeals(job(CrmDealsJob.RenewalScan, undefined))
    expect(mocks.renewalTick).toHaveBeenCalledWith({ workspaceId: undefined })
  })

  it('throws when the scan fails so BullMQ retries', async () => {
    mocks.renewalTick.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'down' },
    })
    await expect(processCrmDeals(job(CrmDealsJob.RenewalScan))).rejects.toThrow(
      'DATABASE_ERROR',
    )
  })

  it('rejects an unknown job name', async () => {
    await expect(processCrmDeals(job('nope', {}, null))).rejects.toThrow(
      'Unknown crm-deals job: nope (id=unknown)',
    )
  })
})
