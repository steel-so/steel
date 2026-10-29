import type { Job } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'
import { crmCnpjRunNotFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/services/crm-cnpj-enrichment-runner.service', () => ({
  CrmCnpjEnrichmentRunner: { run: vi.fn() },
}))

import { CrmCnpjEnrichmentRunner } from '@/src/services/crm-cnpj-enrichment-runner.service'
import { processCrmCnpjEnrichment } from '../queue/processors/crm-cnpj-enrichment'

const job = (name: string) =>
  ({ id: 'j1', name, data: { runId: 'run1' } }) as unknown as Job

describe('processCrmCnpjEnrichment', () => {
  it('runs the enrichment and returns its summary', async () => {
    vi.mocked(CrmCnpjEnrichmentRunner.run).mockResolvedValue(
      ok({ status: 'COMPLETED', processed: 4, enriched: 3 }),
    )
    expect(await processCrmCnpjEnrichment(job('run-enrichment'))).toEqual({
      status: 'COMPLETED',
      processed: 4,
    })
    expect(CrmCnpjEnrichmentRunner.run).toHaveBeenCalledWith('run1')
  })

  it('returns the error code instead of throwing', async () => {
    vi.mocked(CrmCnpjEnrichmentRunner.run).mockResolvedValue(
      err(crmCnpjRunNotFound()),
    )
    expect(await processCrmCnpjEnrichment(job('run-enrichment'))).toEqual({
      error: 'CRM_CNPJ_RUN_NOT_FOUND',
    })
  })

  it('rejects unknown job names', async () => {
    await expect(processCrmCnpjEnrichment(job('other'))).rejects.toThrow(
      'Unknown crm-cnpj-enrichment job',
    )
  })
})
