import { describe, expect, it, vi } from 'vitest'
import { seedAiActionConnector } from '@/src/__tests__/factories/nov-ai-actions.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { AiActionConnectorRepository } from '../ai-action-connector.repository'
import { AiActionExecutionRepository } from '../ai-action-execution.repository'
import { AiActionSettingsRepository } from '../ai-action-settings.repository'

const WINDOWS = {
  staleBefore: new Date('2000-01-01T00:00:00Z'),
  replayBefore: new Date('2000-01-01T00:00:00Z'),
}
const FUTURE = {
  staleBefore: new Date('2999-01-01T00:00:00Z'),
  replayBefore: new Date('2999-01-01T00:00:00Z'),
}

describe('AiActionConnectorRepository', () => {
  it('should create, find, list, count, update and delete per workspace', async () => {
    const workspace = await seedWorkspace()
    const other = await seedWorkspace()
    const created = expectOk(
      await AiActionConnectorRepository.create({
        workspaceId: workspace.id,
        key: 'consultar_pedido',
        name: 'Consultar pedido',
        description: 'Busca',
        kind: 'LOOKUP',
        method: 'GET',
        urlTemplate: 'https://api.cliente.com.br/p/{id}',
        params: [],
      }),
    )
    await seedAiActionConnector({ workspaceId: other.id })

    expect(
      expectOk(await AiActionConnectorRepository.listByWorkspace(workspace.id))
        .length,
    ).toBe(1)
    expect(
      expectOk(await AiActionConnectorRepository.count(workspace.id)),
    ).toBe(1)
    expect(
      expectOk(
        await AiActionConnectorRepository.findById(created.id, workspace.id),
      )?.key,
    ).toBe('consultar_pedido')
    expect(
      expectOk(
        await AiActionConnectorRepository.findById(created.id, other.id),
      ),
    ).toBeNull()
    expect(
      expectOk(
        await AiActionConnectorRepository.findByKey(
          workspace.id,
          'consultar_pedido',
        ),
      )?.id,
    ).toBe(created.id)

    const updated = expectOk(
      await AiActionConnectorRepository.update(created.id, { enabled: false }),
    )
    expect(updated.enabled).toBe(false)
    expectOk(await AiActionConnectorRepository.delete(created.id))
    expect(
      expectOk(await AiActionConnectorRepository.count(workspace.id)),
    ).toBe(0)
  })

  it('should refuse a duplicated key in the same workspace', async () => {
    const workspace = await seedWorkspace()
    const input = {
      workspaceId: workspace.id,
      key: 'dup',
      name: 'Dup',
      description: 'd',
      kind: 'LOOKUP' as const,
      method: 'GET',
      urlTemplate: 'https://api.cliente.com.br/p',
      params: [],
    }
    expectOk(await AiActionConnectorRepository.create(input))
    expectErr(
      await AiActionConnectorRepository.create(input),
      'AI_ACTION_CONNECTOR_KEY_TAKEN',
    )
  })

  it('should turn database failures into errors', async () => {
    const spy = vi
      .spyOn(prisma.aiActionConnector, 'findMany')
      .mockRejectedValueOnce(new Error('boom'))
    expectErr(
      await AiActionConnectorRepository.listByWorkspace('w'),
      'DATABASE_ERROR',
    )
    spy.mockRestore()
    for (const method of [
      'findFirst',
      'findUnique',
      'count',
      'create',
      'update',
      'delete',
    ] as const) {
      vi.spyOn(prisma.aiActionConnector, method).mockRejectedValueOnce(
        new Error('boom'),
      )
    }
    expectErr(await AiActionConnectorRepository.findById('i', 'w'))
    expectErr(await AiActionConnectorRepository.findByKey('w', 'k'))
    expectErr(await AiActionConnectorRepository.count('w'))
    expectErr(
      await AiActionConnectorRepository.create({
        workspaceId: 'w',
        key: 'k',
        name: 'n',
        description: 'd',
        kind: 'LOOKUP',
        method: 'GET',
        urlTemplate: 'u',
      }),
      'DATABASE_ERROR',
    )
    expectErr(await AiActionConnectorRepository.update('i', {}))
    expectErr(await AiActionConnectorRepository.delete('i'))
    vi.restoreAllMocks()
  })
})

describe('AiActionSettingsRepository', () => {
  it('should upsert and find the settings', async () => {
    const workspace = await seedWorkspace()
    expect(
      expectOk(await AiActionSettingsRepository.find(workspace.id)),
    ).toBeNull()
    expectOk(
      await AiActionSettingsRepository.upsert(workspace.id, { enabled: true }),
    )
    const again = expectOk(
      await AiActionSettingsRepository.upsert(workspace.id, {
        zapTools: [{ toolName: 'act_lookup', mode: 'AUTO' }],
      }),
    )
    expect(again.enabled).toBe(true)
    expect(again.zapTools).toEqual([{ toolName: 'act_lookup', mode: 'AUTO' }])
  })

  it('should turn database failures into errors', async () => {
    vi.spyOn(prisma.aiActionSettings, 'findUnique').mockRejectedValueOnce(
      new Error('boom'),
    )
    vi.spyOn(prisma.aiActionSettings, 'upsert').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(await AiActionSettingsRepository.find('w'), 'DATABASE_ERROR')
    expectErr(
      await AiActionSettingsRepository.upsert('w', { enabled: true }),
      'DATABASE_ERROR',
    )
    vi.restoreAllMocks()
  })
})

describe('AiActionExecutionRepository', () => {
  it('should claim a fresh key and replay it once it succeeded', async () => {
    const workspace = await seedWorkspace()
    const first = expectOk(
      await AiActionExecutionRepository.claim(workspace.id, 'k', 'c', FUTURE),
    )
    expect(first.kind).toBe('claimed')
    if (first.kind !== 'claimed') return
    expectOk(
      await AiActionExecutionRepository.complete(first.id, {
        status: 'SUCCESS',
        httpStatus: 200,
        response: { ok: true },
      }),
    )
    const second = expectOk(
      await AiActionExecutionRepository.claim(workspace.id, 'k', 'c', WINDOWS),
    )
    expect(second.kind).toBe('existing')
    if (second.kind === 'existing') {
      expect(second.row.status).toBe('SUCCESS')
      expect(second.row.response).toEqual({ ok: true })
    }
  })

  it('should keep a fresh PENDING claim and take over a stale one', async () => {
    const workspace = await seedWorkspace()
    expectOk(
      await AiActionExecutionRepository.claim(workspace.id, 'k', 'c', WINDOWS),
    )
    const fresh = expectOk(
      await AiActionExecutionRepository.claim(workspace.id, 'k', 'c', WINDOWS),
    )
    expect(fresh.kind).toBe('existing')
    const stale = expectOk(
      await AiActionExecutionRepository.claim(workspace.id, 'k', 'c', FUTURE),
    )
    expect(stale.kind).toBe('claimed')
  })

  it('should retry after a failure and after the replay window', async () => {
    const workspace = await seedWorkspace()
    const first = expectOk(
      await AiActionExecutionRepository.claim(workspace.id, 'k', 'c', WINDOWS),
    )
    if (first.kind !== 'claimed') throw new Error('expected claim')
    expectOk(
      await AiActionExecutionRepository.complete(first.id, {
        status: 'FAILURE',
        httpStatus: 500,
        response: null,
      }),
    )
    const retry = expectOk(
      await AiActionExecutionRepository.claim(workspace.id, 'k', 'c', WINDOWS),
    )
    expect(retry.kind).toBe('claimed')
    if (retry.kind !== 'claimed') return
    expectOk(
      await AiActionExecutionRepository.complete(retry.id, {
        status: 'SUCCESS',
        httpStatus: 200,
        response: null,
      }),
    )
    const later = expectOk(
      await AiActionExecutionRepository.claim(workspace.id, 'k', 'c', {
        staleBefore: WINDOWS.staleBefore,
        replayBefore: FUTURE.replayBefore,
      }),
    )
    expect(later.kind).toBe('claimed')
  })

  it('should let only one of two concurrent takeovers win', async () => {
    const workspace = await seedWorkspace()
    expectOk(
      await AiActionExecutionRepository.claim(workspace.id, 'k', 'c', WINDOWS),
    )
    const results = await Promise.all([
      AiActionExecutionRepository.claim(workspace.id, 'k', 'c', FUTURE),
      AiActionExecutionRepository.claim(workspace.id, 'k', 'c', FUTURE),
    ])
    const kinds = results.map((r) => expectOk(r).kind)
    expect(kinds.filter((k) => k === 'claimed').length).toBeGreaterThanOrEqual(
      1,
    )
  })

  it('should turn database failures into errors', async () => {
    vi.spyOn(prisma.aiActionExecution, 'create').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(
      await AiActionExecutionRepository.claim('w', 'k', 'c', WINDOWS),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.aiActionExecution, 'update').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(
      await AiActionExecutionRepository.complete('i', {
        status: 'FAILURE',
        httpStatus: null,
        response: null,
      }),
      'DATABASE_ERROR',
    )
    vi.restoreAllMocks()
  })
})
