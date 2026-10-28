import { describe, expect, it, vi } from 'vitest'

const runCheckTick = vi.hoisted(() => vi.fn())
vi.mock('@/src/services/sending-domain.service', () => ({
  SendingDomainService: { runCheckTick },
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import type { Job } from 'bullmq'
import { SendingDomainsJob } from '../queue/jobs'
import { processSendingDomains } from '../queue/processors/sending-domains'

describe('processSendingDomains', () => {
  it('runs the check tick', async () => {
    runCheckTick.mockResolvedValue({ checked: 2, failed: 0, changed: 1 })
    const result = await processSendingDomains({
      name: SendingDomainsJob.CheckTick,
      id: 'j1',
    } as Job)
    expect(result).toEqual({ checked: 2, failed: 0, changed: 1 })
    expect(runCheckTick).toHaveBeenCalledOnce()
  })

  it('throws on an unknown job', async () => {
    await expect(
      processSendingDomains({ name: 'nope', id: undefined } as unknown as Job),
    ).rejects.toThrow('Unknown sending-domains job: nope (id=unknown)')
  })
})
