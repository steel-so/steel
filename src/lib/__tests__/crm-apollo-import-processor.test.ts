import type { Job } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'
import { crmApolloImportNotFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/services/crm-apollo-import-runner.service', () => ({
  CrmApolloImportRunner: { run: vi.fn() },
}))

import { CrmApolloImportRunner } from '@/src/services/crm-apollo-import-runner.service'
import { processCrmApolloImport } from '../queue/processors/crm-apollo-import'

const job = (name: string) =>
  ({ id: 'j1', name, data: { importId: 'imp1' } }) as unknown as Job

describe('processCrmApolloImport', () => {
  it('runs the import and returns its state', async () => {
    vi.mocked(CrmApolloImportRunner.run).mockResolvedValue(
      ok({ state: 'DONE' }),
    )
    expect(await processCrmApolloImport(job('run-import'))).toEqual({
      state: 'DONE',
    })
    expect(CrmApolloImportRunner.run).toHaveBeenCalledWith('imp1')
  })

  it('returns the error code instead of throwing', async () => {
    vi.mocked(CrmApolloImportRunner.run).mockResolvedValue(
      err(crmApolloImportNotFound()),
    )
    expect(await processCrmApolloImport(job('run-import'))).toEqual({
      error: 'CRM_APOLLO_IMPORT_NOT_FOUND',
    })
  })

  it('rejects unknown job names', async () => {
    await expect(processCrmApolloImport(job('other'))).rejects.toThrow(
      'Unknown crm-apollo-import job',
    )
  })
})
