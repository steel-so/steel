import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/src/services/notification-emitter', () => ({
  emitNotification: vi.fn(async () => 1),
}))

import { emitNotification } from '@/src/services/notification-emitter'
import { notifyCnpjRunFinished } from '../crm-cnpj-notifications'

const emit = vi.mocked(emitNotification)

const base = {
  workspaceId: 'ws1',
  runId: 'r1',
  createdById: 'u1',
  total: 10,
  processed: 10,
  enriched: 7,
  notFound: 1,
  invalid: 1,
  failed: 1,
}

beforeEach(() => emit.mockClear())

describe('notifyCnpjRunFinished', () => {
  it('summarizes a completed run for whoever started it', async () => {
    await notifyCnpjRunFinished({ ...base, status: 'COMPLETED' })
    expect(emit).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      recipients: ['u1'],
      kind: 'CRM_CNPJ_ENRICHMENT_FINISHED',
      title: 'Enriquecimento de empresas concluído',
      body: 'Consultadas 10 de 10 empresas · 7 atualizadas · 2 sem registro na Receita · 1 falha.',
      path: '/crm/companies',
      dedupeKey: 'crm-cnpj-run:r1',
    })
  })

  it('says how far a canceled run got and omits empty counters', async () => {
    await notifyCnpjRunFinished({
      ...base,
      status: 'CANCELED',
      total: 1,
      processed: 1,
      enriched: 1,
      notFound: 0,
      invalid: 0,
      failed: 0,
    })
    const input = emit.mock.calls[0][0]
    expect(input.title).toBe('Enriquecimento de empresas cancelado')
    expect(input.body).toBe('Consultadas 1 de 1 empresa · 1 atualizada.')
  })

  it('shows the error of a failed run, truncated', async () => {
    await notifyCnpjRunFinished({
      ...base,
      status: 'FAILED',
      error: 'x'.repeat(400),
    })
    const input = emit.mock.calls[0][0]
    expect(input.title).toBe('Enriquecimento de empresas falhou')
    expect(input.body).toHaveLength(280)
  })

  it('falls back to the counters when a failed run has no error text', async () => {
    await notifyCnpjRunFinished({ ...base, status: 'FAILED' })
    expect(emit.mock.calls[0][0].body).toContain(
      'Consultadas 10 de 10 empresas',
    )
  })
})
