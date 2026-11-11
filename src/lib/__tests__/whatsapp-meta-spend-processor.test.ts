import { describe, expect, it, vi } from 'vitest'

const refreshTick = vi.hoisted(() => vi.fn())
vi.mock('@/src/services/whatsapp-spend-cap.service', () => ({
  WhatsAppSpendCapService: { refreshTick },
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import type { Job } from 'bullmq'
import { WhatsappMetaSpendJob } from '../queue/jobs'
import { processWhatsappMetaSpend } from '../queue/processors/whatsapp-meta-spend'

describe('processWhatsappMetaSpend', () => {
  it('runs the refresh tick', async () => {
    refreshTick.mockResolvedValue({ connections: 2, refreshed: 1, failed: 1 })
    const result = await processWhatsappMetaSpend({
      name: WhatsappMetaSpendJob.RefreshTick,
      id: 'j1',
    } as Job)
    expect(result).toEqual({ connections: 2, refreshed: 1, failed: 1 })
    expect(refreshTick).toHaveBeenCalledOnce()
  })

  it('throws on an unknown job', async () => {
    const job = { name: 'nope', id: undefined } as unknown as Job
    await expect(processWhatsappMetaSpend(job)).rejects.toThrow(
      'Unknown whatsapp-meta-spend job: nope (id=unknown)',
    )
  })
})
