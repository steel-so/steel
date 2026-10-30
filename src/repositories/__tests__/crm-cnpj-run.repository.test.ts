import { describe, expect, it, vi } from 'vitest'
import { seedCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import { seedCnpjRun } from '@/src/__tests__/factories/nov-c2-cnpj-enrichment.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmCnpjRunRepository } from '../crm-cnpj-run.repository'
import { CrmCompanyEnrichmentRepository } from '../crm-company-enrichment.repository'

describe('CrmCnpjRunRepository', () => {
  it('creates, lists newest first and finds scoped to the workspace', async () => {
    const [ws, other, user] = await Promise.all([
      seedWorkspace(),
      seedWorkspace(),
      seedUser(),
    ])
    const first = expectOk(
      await CrmCnpjRunRepository.create({
        workspaceId: ws.id,
        createdById: user.id,
        onlyMissing: true,
        overwrite: false,
        total: 4,
      }),
    )
    expect(first).toMatchObject({ status: 'QUEUED', total: 4, processed: 0 })
    const second = await seedCnpjRun(ws.id, user.id)
    await seedCnpjRun(other.id, user.id)

    const list = expectOk(await CrmCnpjRunRepository.listByWorkspace(ws.id, 10))
    expect(list.map((r) => r.id)).toEqual([second.id, first.id])
    expectOk(await CrmCnpjRunRepository.findById(first.id, ws.id))
    expectErr(
      await CrmCnpjRunRepository.findById(first.id, other.id),
      'CRM_CNPJ_RUN_NOT_FOUND',
    )
    expectOk(await CrmCnpjRunRepository.findByIdForWorker(first.id))
    expectErr(
      await CrmCnpjRunRepository.findByIdForWorker('nope'),
      'CRM_CNPJ_RUN_NOT_FOUND',
    )
  })

  it('finds only a queued or running run as active', async () => {
    const [ws, user] = await Promise.all([seedWorkspace(), seedUser()])
    expect(expectOk(await CrmCnpjRunRepository.findActive(ws.id))).toBeNull()
    await seedCnpjRun(ws.id, user.id, { status: 'COMPLETED' })
    expect(expectOk(await CrmCnpjRunRepository.findActive(ws.id))).toBeNull()
    const running = await seedCnpjRun(ws.id, user.id, { status: 'RUNNING' })
    expect(expectOk(await CrmCnpjRunRepository.findActive(ws.id))?.id).toBe(
      running.id,
    )
  })

  it('cancels a queued run at once and flags a running one', async () => {
    const [ws, other, user] = await Promise.all([
      seedWorkspace(),
      seedWorkspace(),
      seedUser(),
    ])
    const queued = await seedCnpjRun(ws.id, user.id, { status: 'QUEUED' })
    const canceled = expectOk(
      await CrmCnpjRunRepository.requestCancel(queued.id, ws.id),
    )
    expect(canceled.status).toBe('CANCELED')
    expect(canceled.finishedAt).not.toBeNull()
    expectErr(
      await CrmCnpjRunRepository.requestCancel(queued.id, ws.id),
      'CRM_CNPJ_RUN_NOT_CANCELABLE',
    )

    const running = await seedCnpjRun(ws.id, user.id, { status: 'RUNNING' })
    expect(
      expectOk(await CrmCnpjRunRepository.isCancelRequested(running.id)),
    ).toBe(false)
    expectErr(
      await CrmCnpjRunRepository.requestCancel(running.id, other.id),
      'CRM_CNPJ_RUN_NOT_FOUND',
    )
    const flagged = expectOk(
      await CrmCnpjRunRepository.requestCancel(running.id, ws.id),
    )
    expect(flagged.status).toBe('RUNNING')
    expect(flagged.cancelRequestedAt).not.toBeNull()
    expect(
      expectOk(await CrmCnpjRunRepository.isCancelRequested(running.id)),
    ).toBe(true)
    expect(
      expectOk(await CrmCnpjRunRepository.isCancelRequested(queued.id)),
    ).toBe(true)
    expect(expectOk(await CrmCnpjRunRepository.isCancelRequested('nope'))).toBe(
      false,
    )
  })

  it('updates status and counters', async () => {
    const [ws, user] = await Promise.all([seedWorkspace(), seedUser()])
    const run = await seedCnpjRun(ws.id, user.id)
    const updated = expectOk(
      await CrmCnpjRunRepository.update(run.id, {
        status: 'RUNNING',
        processed: 3,
        enriched: 2,
        startedAt: new Date(),
      }),
    )
    expect(updated).toMatchObject({
      status: 'RUNNING',
      processed: 3,
      enriched: 2,
    })
    expectErr(
      await CrmCnpjRunRepository.update('nope', { processed: 1 }),
      'DATABASE_ERROR',
    )
  })

  it('lists and counts targets: CNPJ present, not deleted, optionally unenriched', async () => {
    const [ws, other, user] = await Promise.all([
      seedWorkspace(),
      seedWorkspace(),
      seedUser(),
    ])
    const a = await seedCrmCompany(ws.id, user.id, { cnpj: '11222333000181' })
    const b = await seedCrmCompany(ws.id, user.id, { cnpj: '11444777000161' })
    await seedCrmCompany(ws.id, user.id, { cnpj: null, domain: 'x.com' })
    await seedCrmCompany(ws.id, user.id, {
      cnpj: '45723174000110',
      deletedAt: new Date(),
    })
    await seedCrmCompany(other.id, user.id, { cnpj: '11222333000181' })
    await CrmCompanyEnrichmentRepository.upsert(a.id, ws.id, {
      cnpj: '11222333000181',
    })

    const all = expectOk(
      await CrmCnpjRunRepository.listTargets(ws.id, {
        onlyMissing: false,
        take: 10,
      }),
    )
    expect(all.map((c) => c.id).sort()).toEqual([a.id, b.id].sort())

    const missing = expectOk(
      await CrmCnpjRunRepository.listTargets(ws.id, {
        onlyMissing: true,
        take: 10,
      }),
    )
    expect(missing.map((c) => c.id)).toEqual([b.id])

    const [first] = all.map((c) => c.id).sort()
    const afterFirst = expectOk(
      await CrmCnpjRunRepository.listTargets(ws.id, {
        onlyMissing: false,
        afterId: first,
        take: 10,
      }),
    )
    expect(afterFirst).toHaveLength(1)

    expect(
      expectOk(await CrmCnpjRunRepository.countTargets(ws.id, false)),
    ).toBe(2)
    expect(expectOk(await CrmCnpjRunRepository.countTargets(ws.id, true))).toBe(
      1,
    )
  })

  it('returns database errors', async () => {
    const find = vi
      .spyOn(prisma.crmCompany, 'findMany')
      .mockRejectedValueOnce(new Error('boom'))
    expectErr(
      await CrmCnpjRunRepository.listTargets('w', {
        onlyMissing: true,
        take: 1,
      }),
      'DATABASE_ERROR',
    )
    find.mockRestore()
    const count = vi
      .spyOn(prisma.crmCompany, 'count')
      .mockRejectedValueOnce(new Error('boom'))
    expectErr(
      await CrmCnpjRunRepository.countTargets('w', true),
      'DATABASE_ERROR',
    )
    count.mockRestore()
    const create = vi
      .spyOn(prisma.crmCnpjEnrichmentRun, 'create')
      .mockRejectedValueOnce(new Error('boom'))
    expectErr(
      await CrmCnpjRunRepository.create({
        workspaceId: 'w',
        createdById: 'u',
        onlyMissing: true,
        overwrite: false,
        total: 0,
      }),
      'DATABASE_ERROR',
    )
    create.mockRestore()
    for (const method of ['findFirst', 'findMany', 'findUnique'] as const) {
      const spy = vi
        .spyOn(prisma.crmCnpjEnrichmentRun, method)
        .mockRejectedValueOnce(new Error('boom'))
      const result =
        method === 'findFirst'
          ? await CrmCnpjRunRepository.findActive('w')
          : method === 'findMany'
            ? await CrmCnpjRunRepository.listByWorkspace('w', 1)
            : await CrmCnpjRunRepository.findByIdForWorker('x')
      expectErr(result, 'DATABASE_ERROR')
      spy.mockRestore()
    }
    const byId = vi
      .spyOn(prisma.crmCnpjEnrichmentRun, 'findFirst')
      .mockRejectedValueOnce(new Error('boom'))
    expectErr(await CrmCnpjRunRepository.findById('x', 'w'), 'DATABASE_ERROR')
    byId.mockRestore()
  })
})
