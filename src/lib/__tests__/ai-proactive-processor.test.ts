import { describe, expect, it, vi } from 'vitest'

vi.mock('@/src/services/ai-insight-generator.service', () => ({
  AiInsightGeneratorService: { runTick: vi.fn() },
}))
vi.mock('@/src/services/ai-digest.service', () => ({
  AiDigestService: { runTick: vi.fn() },
}))

import type { Job } from 'bullmq'
import { processAiProactive } from '@/src/lib/queue/processors/ai-proactive'
import { AiDigestService } from '@/src/services/ai-digest.service'
import { AiInsightGeneratorService } from '@/src/services/ai-insight-generator.service'

function job(name: string, id?: string): Job {
  return { name, id } as Job
}

describe('processAiProactive', () => {
  it('runs the insights tick', async () => {
    const result = { workspaces: 2, errors: 0 }
    vi.mocked(AiInsightGeneratorService.runTick).mockResolvedValue(
      result as never,
    )
    expect(await processAiProactive(job('insights-tick', 'j1'))).toBe(result)
  })

  it('runs the digest tick', async () => {
    const result = { workspaces: 1, sent: 3 }
    vi.mocked(AiDigestService.runTick).mockResolvedValue(result as never)
    expect(await processAiProactive(job('digest-tick', 'j2'))).toBe(result)
  })

  it('rejects an unknown job', async () => {
    await expect(processAiProactive(job('nope', 'j3'))).rejects.toThrow(
      'Unknown ai-proactive job: nope (id=j3)',
    )
    await expect(processAiProactive(job('nope'))).rejects.toThrow(
      '(id=unknown)',
    )
  })
})
