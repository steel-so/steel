import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import {
  createFakeCnpjRun,
  VALID_CNPJ,
} from '@/src/__tests__/factories/nov-c2-cnpj-enrichment.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  crmCnpjInvalid,
  crmCnpjLookupFailed,
  crmCnpjNotFound,
  crmCnpjRateLimited,
  crmCnpjRunNotFound,
  databaseError,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/crm-cnpj-run.repository')
vi.mock('../crm-cnpj-enrichment.service', () => ({ enrichCompany: vi.fn() }))
vi.mock('../crm-cnpj-notifications', () => ({
  notifyCnpjRunFinished: vi.fn(async () => 1),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { CrmCnpjRunRepository } from '@/src/repositories/crm-cnpj-run.repository'
import { enrichCompany } from '../crm-cnpj-enrichment.service'
import { CrmCnpjEnrichmentRunner } from '../crm-cnpj-enrichment-runner.service'
import { notifyCnpjRunFinished } from '../crm-cnpj-notifications'

const runs = vi.mocked(CrmCnpjRunRepository)
const enrich = vi.mocked(enrichCompany)
const sleep = vi.fn(async () => undefined)

const co = (id: string) => createFakeCrmCompany({ id, cnpj: VALID_CNPJ })

beforeEach(() => {
  vi.clearAllMocks()
  runs.findByIdForWorker.mockResolvedValue(
    ok(createFakeCnpjRun({ id: 'r1', workspaceId: 'ws1', createdById: 'u1' })),
  )
  runs.isCancelRequested.mockResolvedValue(ok(false))
  runs.update.mockImplementation(async (id, data) =>
    ok(createFakeCnpjRun({ id, ...(data as object) })),
  )
})

describe('CrmCnpjEnrichmentRunner', () => {
  it('walks every page and records the outcome of each company', async () => {
    runs.listTargets
      .mockResolvedValueOnce(ok([co('a'), co('b'), co('c'), co('d'), co('e')]))
      .mockResolvedValueOnce(ok([]))
    enrich
      .mockResolvedValueOnce(ok({} as never))
      .mockResolvedValueOnce(err(crmCnpjNotFound()))
      .mockResolvedValueOnce(err(crmCnpjInvalid()))
      .mockResolvedValueOnce(err(crmCnpjLookupFailed()))
      .mockResolvedValueOnce(ok({} as never))

    const summary = expectOk(await CrmCnpjEnrichmentRunner.run('r1', sleep))

    expect(summary).toEqual({ status: 'COMPLETED', processed: 5, enriched: 2 })
    expect(runs.listTargets).toHaveBeenNthCalledWith(2, 'ws1', {
      onlyMissing: true,
      afterId: 'e',
      take: 25,
    })
    expect(enrich).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      actorId: 'u1',
      company: expect.objectContaining({ id: 'a' }),
      overwrite: false,
    })
    expect(runs.update).toHaveBeenLastCalledWith(
      'r1',
      expect.objectContaining({
        status: 'COMPLETED',
        processed: 5,
        enriched: 2,
        notFound: 1,
        invalid: 1,
        failed: 1,
      }),
    )
    expect(auditMutation).toHaveBeenCalled()
  })

  it('notifies whoever started the run when it completes', async () => {
    runs.findByIdForWorker.mockResolvedValue(
      ok(
        createFakeCnpjRun({
          id: 'r1',
          workspaceId: 'ws1',
          createdById: 'u1',
          total: 2,
        }),
      ),
    )
    runs.listTargets
      .mockResolvedValueOnce(ok([co('a'), co('b')]))
      .mockResolvedValueOnce(ok([]))
    enrich
      .mockResolvedValueOnce(ok({} as never))
      .mockResolvedValueOnce(err(crmCnpjNotFound()))

    await CrmCnpjEnrichmentRunner.run('r1', sleep)

    expect(notifyCnpjRunFinished).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      runId: 'r1',
      createdById: 'u1',
      status: 'COMPLETED',
      total: 2,
      processed: 2,
      enriched: 1,
      notFound: 1,
      invalid: 0,
      failed: 0,
      error: undefined,
    })
  })

  it('stops between companies when a cancel was requested', async () => {
    runs.listTargets.mockResolvedValue(ok([co('a'), co('b'), co('c')]))
    enrich.mockResolvedValue(ok({} as never))
    runs.isCancelRequested
      .mockResolvedValueOnce(ok(false))
      .mockResolvedValueOnce(ok(true))

    const summary = expectOk(await CrmCnpjEnrichmentRunner.run('r1', sleep))

    expect(summary).toEqual({ status: 'CANCELED', processed: 1, enriched: 1 })
    expect(enrich).toHaveBeenCalledTimes(1)
    expect(runs.listTargets).toHaveBeenCalledTimes(1)
    expect(runs.update).toHaveBeenLastCalledWith(
      'r1',
      expect.objectContaining({ status: 'CANCELED', processed: 1 }),
    )
    expect(notifyCnpjRunFinished).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CANCELED', processed: 1 }),
    )
  })

  it('ignores a failed cancel check and keeps enriching', async () => {
    runs.listTargets
      .mockResolvedValueOnce(ok([co('a')]))
      .mockResolvedValueOnce(ok([]))
    enrich.mockResolvedValue(ok({} as never))
    runs.isCancelRequested.mockResolvedValue(err(databaseError('x')))

    const summary = expectOk(await CrmCnpjEnrichmentRunner.run('r1', sleep))

    expect(summary.status).toBe('COMPLETED')
  })

  it('does not replay a canceled run', async () => {
    runs.findByIdForWorker.mockResolvedValue(
      ok(createFakeCnpjRun({ status: 'CANCELED', processed: 3, enriched: 3 })),
    )
    expect(expectOk(await CrmCnpjEnrichmentRunner.run('r1', sleep))).toEqual({
      status: 'CANCELED',
      processed: 3,
      enriched: 3,
    })
    expect(runs.update).not.toHaveBeenCalled()
  })

  it('backs off on a rate limit and retries the same company', async () => {
    runs.listTargets
      .mockResolvedValueOnce(ok([co('a')]))
      .mockResolvedValueOnce(ok([]))
    enrich
      .mockResolvedValueOnce(err(crmCnpjRateLimited()))
      .mockResolvedValueOnce(ok({} as never))

    const summary = expectOk(await CrmCnpjEnrichmentRunner.run('r1', sleep))

    expect(summary.enriched).toBe(1)
    expect(enrich).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(30_000)
  })

  it('counts a company as failed once the rate-limit retries run out', async () => {
    runs.listTargets
      .mockResolvedValueOnce(ok([co('a')]))
      .mockResolvedValueOnce(ok([]))
    enrich.mockResolvedValue(err(crmCnpjRateLimited()))

    const summary = expectOk(await CrmCnpjEnrichmentRunner.run('r1', sleep))

    expect(summary).toMatchObject({ processed: 1, enriched: 0 })
    expect(enrich).toHaveBeenCalledTimes(4)
    expect(runs.update).toHaveBeenLastCalledWith(
      'r1',
      expect.objectContaining({ failed: 1 }),
    )
  })

  it('completes an empty base', async () => {
    runs.listTargets.mockResolvedValue(ok([]))
    expect(expectOk(await CrmCnpjEnrichmentRunner.run('r1', sleep))).toEqual({
      status: 'COMPLETED',
      processed: 0,
      enriched: 0,
    })
    expect(enrich).not.toHaveBeenCalled()
  })

  it('does not replay a finished run', async () => {
    runs.findByIdForWorker.mockResolvedValue(
      ok(createFakeCnpjRun({ status: 'COMPLETED', processed: 9, enriched: 8 })),
    )
    expect(expectOk(await CrmCnpjEnrichmentRunner.run('r1', sleep))).toEqual({
      status: 'COMPLETED',
      processed: 9,
      enriched: 8,
    })
    expect(runs.update).not.toHaveBeenCalled()
  })

  it('returns a missing run', async () => {
    runs.findByIdForWorker.mockResolvedValue(err(crmCnpjRunNotFound()))
    expectErr(
      await CrmCnpjEnrichmentRunner.run('nope', sleep),
      'CRM_CNPJ_RUN_NOT_FOUND',
    )
  })

  it('stops when the run cannot be marked as started', async () => {
    runs.update.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await CrmCnpjEnrichmentRunner.run('r1', sleep), 'DATABASE_ERROR')
    expect(runs.listTargets).not.toHaveBeenCalled()
  })

  it('fails the run when a page cannot be read', async () => {
    runs.listTargets.mockResolvedValue(err(databaseError('x')))
    expectErr(await CrmCnpjEnrichmentRunner.run('r1', sleep), 'DATABASE_ERROR')
    expect(runs.update).toHaveBeenLastCalledWith(
      'r1',
      expect.objectContaining({ status: 'FAILED' }),
    )
    expect(notifyCnpjRunFinished).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        error: 'Falha ao ler as empresas do workspace',
      }),
    )
  })

  it('keeps going when a progress write fails, and reports a failed final write', async () => {
    runs.listTargets
      .mockResolvedValueOnce(ok([co('a')]))
      .mockResolvedValueOnce(ok([]))
    enrich.mockResolvedValue(ok({} as never))
    runs.update
      .mockResolvedValueOnce(ok(createFakeCnpjRun()))
      .mockResolvedValueOnce(err(databaseError('progress')))
      .mockResolvedValueOnce(err(databaseError('final')))
    expectErr(await CrmCnpjEnrichmentRunner.run('r1', sleep), 'DATABASE_ERROR')
  })

  it('uses the real timer by default', async () => {
    vi.useFakeTimers()
    runs.listTargets
      .mockResolvedValueOnce(ok([co('a')]))
      .mockResolvedValueOnce(ok([]))
    enrich.mockResolvedValue(ok({} as never))
    const promise = CrmCnpjEnrichmentRunner.run('r1')
    await vi.advanceTimersByTimeAsync(1_000)
    expectOk(await promise)
    vi.useRealTimers()
  })
})
