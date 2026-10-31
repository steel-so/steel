import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeAiActionConnector,
  createFakeAiActionExecution,
  createFakeAiActionSettings,
} from '@/src/__tests__/factories/nov-ai-actions.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  aiActionConnectorFailed,
  databaseError,
  forbidden,
  webhookUrlNotAllowed,
} from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit')
vi.mock('@/src/services/authz')
vi.mock('@/src/repositories/ai-action-connector.repository')
vi.mock('@/src/repositories/ai-action-settings.repository')
vi.mock('@/src/repositories/ai-action-execution.repository')
vi.mock('@/src/lib/crypto', () => ({
  encryptConnectionSecret: vi.fn(async (plain: string) => `enc:${plain}`),
  decryptConnectionSecret: vi.fn(async (env: string) => {
    if (env === 'broken') throw new Error('bad')
    if (env === 'array') return '"not-an-object"'
    return env.replace(/^enc:/, '')
  }),
}))
vi.mock('@/src/lib/ai-actions/http-connector', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/src/lib/ai-actions/http-connector')
  >()),
  callConnector: vi.fn(),
  guardConnectorUrl: vi.fn(async (url: string) =>
    url.includes('private')
      ? err(webhookUrlNotAllowed())
      : ok(new URL(url)),
  ),
}))
vi.mock('@/src/lib/ai/tools/registry', () => ({
  findTool: vi.fn((name: string) => (name === 'act_run' ? {} : undefined)),
}))

import { callConnector } from '@/src/lib/ai-actions/http-connector'
import { AiActionConnectorRepository } from '@/src/repositories/ai-action-connector.repository'
import { AiActionExecutionRepository } from '@/src/repositories/ai-action-execution.repository'
import { AiActionSettingsRepository } from '@/src/repositories/ai-action-settings.repository'
import { assertMember, assertPrivileged } from '@/src/services/authz'
import { AiActionService } from '../ai-action.service'

const connectors = vi.mocked(AiActionConnectorRepository)
const settings = vi.mocked(AiActionSettingsRepository)
const executions = vi.mocked(AiActionExecutionRepository)
const call = vi.mocked(callConnector)
const member = vi.mocked(assertMember)
const privileged = vi.mocked(assertPrivileged)

const MEMBERSHIP = { role: 'ADMIN' as const, isPrivileged: true, permissions: null }
const CTX = {
  workspaceId: 'ws1',
  actorId: 'u1',
  source: 'agent' as const,
  agentId: 'ag1',
}
const LOOKUP = createFakeAiActionConnector({ workspaceId: 'ws1', id: 'c1' })
const ACTION = createFakeAiActionConnector({
  workspaceId: 'ws1',
  id: 'c2',
  key: 'redefinir_senha',
  name: 'Redefinir senha',
  kind: 'ACTION',
  method: 'POST',
  urlTemplate: 'https://api.cliente.com.br/senha',
  encryptedHeaders: 'enc:{"Authorization":"Bearer t"}',
  params: [{ name: 'email', description: '', required: true }],
})

beforeEach(() => {
  vi.clearAllMocks()
  member.mockResolvedValue(ok(MEMBERSHIP))
  privileged.mockResolvedValue(ok(MEMBERSHIP))
  settings.find.mockResolvedValue(
    ok(createFakeAiActionSettings({ workspaceId: 'ws1', enabled: true })),
  )
})

describe('AiActionService.list', () => {
  it('should list connectors with header names only', async () => {
    connectors.listByWorkspace.mockResolvedValue(ok([LOOKUP, ACTION]))
    const result = expectOk(await AiActionService.list('u1', 'ws1'))
    expect(result.connectors.map((c) => c.headerNames)).toEqual([
      [],
      ['Authorization'],
    ])
    expect(result.settings.enabled).toBe(true)
    expect(result.limit).toBe(25)
  })

  it('should read broken or non-object headers as none', async () => {
    connectors.listByWorkspace.mockResolvedValue(
      ok([
        createFakeAiActionConnector({ encryptedHeaders: 'broken' }),
        createFakeAiActionConnector({ encryptedHeaders: 'array' }),
      ]),
    )
    const result = expectOk(await AiActionService.list('u1', 'ws1'))
    expect(result.connectors.map((c) => c.headerNames)).toEqual([[], []])
  })

  it('should refuse non-privileged users and propagate errors', async () => {
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(await AiActionService.list('u1', 'ws1'), 'FORBIDDEN')
    privileged.mockResolvedValue(ok(MEMBERSHIP))
    connectors.listByWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(await AiActionService.list('u1', 'ws1'), 'DATABASE_ERROR')
    connectors.listByWorkspace.mockResolvedValue(ok([]))
    settings.find.mockResolvedValue(err(databaseError()))
    expectErr(await AiActionService.list('u1', 'ws1'), 'DATABASE_ERROR')
  })
})

describe('AiActionService.create', () => {
  const dto = {
    key: 'redefinir_senha',
    name: 'Redefinir senha',
    description: 'Envia um link de nova senha.',
    kind: 'ACTION' as const,
    method: 'POST' as const,
    urlTemplate: 'https://api.cliente.com.br/senha',
    params: [{ name: 'email', description: '', required: true }],
    enabled: true,
    headers: { Authorization: 'Bearer t' },
  }

  it('should encrypt the headers and audit', async () => {
    connectors.count.mockResolvedValue(ok(0))
    connectors.create.mockResolvedValue(ok(ACTION))
    expectOk(await AiActionService.create('u1', 'ws1', dto))
    const data = connectors.create.mock.calls[0]?.[0]
    expect(data?.encryptedHeaders).toBe('enc:{"Authorization":"Bearer t"}')
  })

  it('should store no headers when none were given', async () => {
    connectors.count.mockResolvedValue(ok(0))
    connectors.create.mockResolvedValue(ok(LOOKUP))
    expectOk(await AiActionService.create('u1', 'ws1', { ...dto, headers: {} }))
    expect(connectors.create.mock.calls[0]?.[0].encryptedHeaders).toBeNull()
  })

  it('should enforce the limit, authz and repository errors', async () => {
    connectors.count.mockResolvedValue(ok(25))
    expectErr(
      await AiActionService.create('u1', 'ws1', dto),
      'AI_ACTION_CONNECTOR_LIMIT_REACHED',
    )
    connectors.count.mockResolvedValue(err(databaseError()))
    expectErr(await AiActionService.create('u1', 'ws1', dto), 'DATABASE_ERROR')
    connectors.count.mockResolvedValue(ok(0))
    connectors.create.mockResolvedValue(err(databaseError()))
    expectErr(await AiActionService.create('u1', 'ws1', dto), 'DATABASE_ERROR')
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(await AiActionService.create('u1', 'ws1', dto), 'FORBIDDEN')
  })
})

describe('AiActionService SSRF guard on save', () => {
  it('should refuse private addresses on create and update', async () => {
    expectErr(
      await AiActionService.create('u1', 'ws1', {
        key: 'x',
        name: 'x',
        description: 'x',
        kind: 'LOOKUP',
        method: 'GET',
        urlTemplate: 'https://private.local/{id}',
        params: [{ name: 'id', description: '', required: true }],
        enabled: true,
        headers: {},
      }),
      'WEBHOOK_URL_NOT_ALLOWED',
    )
    connectors.findById.mockResolvedValue(ok(LOOKUP))
    expectErr(
      await AiActionService.update('u1', 'ws1', 'c1', {
        urlTemplate: 'https://private.local/pedidos/{orderId}',
      }),
      'WEBHOOK_URL_NOT_ALLOWED',
    )
    expect(connectors.create).not.toHaveBeenCalled()
    expect(connectors.update).not.toHaveBeenCalled()
  })
})

describe('AiActionService.update', () => {
  beforeEach(() => {
    connectors.findById.mockResolvedValue(ok(ACTION))
    connectors.update.mockResolvedValue(ok(ACTION))
  })

  it('should replace the headers only when sent', async () => {
    expectOk(
      await AiActionService.update('u1', 'ws1', 'c2', { name: 'Novo' }),
    )
    expect(connectors.update.mock.calls[0]?.[1]).not.toHaveProperty(
      'encryptedHeaders',
    )
    expectOk(
      await AiActionService.update('u1', 'ws1', 'c2', {
        headers: { 'X-Key': 'v' },
      }),
    )
    expect(connectors.update.mock.calls[1]?.[1]).toMatchObject({
      encryptedHeaders: 'enc:{"X-Key":"v"}',
    })
    expectOk(
      await AiActionService.update('u1', 'ws1', 'c2', { headers: {} }),
    )
    expect(connectors.update.mock.calls[2]?.[1]).toMatchObject({
      encryptedHeaders: null,
    })
  })

  it('should re-check the merged connector', async () => {
    expectErr(
      await AiActionService.update('u1', 'ws1', 'c2', { method: 'GET' }),
      'AI_ACTION_CONNECTOR_INVALID',
    )
    expectOk(
      await AiActionService.update('u1', 'ws1', 'c2', {
        params: [{ name: 'email', description: '', required: true }],
      }),
    )
  })

  it('should fail for unknown connectors, authz and database errors', async () => {
    connectors.findById.mockResolvedValue(ok(null))
    expectErr(
      await AiActionService.update('u1', 'ws1', 'x', { name: 'a' }),
      'AI_ACTION_CONNECTOR_NOT_FOUND',
    )
    connectors.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await AiActionService.update('u1', 'ws1', 'x', { name: 'a' }),
      'DATABASE_ERROR',
    )
    connectors.findById.mockResolvedValue(ok(ACTION))
    connectors.update.mockResolvedValue(err(databaseError()))
    expectErr(
      await AiActionService.update('u1', 'ws1', 'c2', { name: 'a' }),
      'DATABASE_ERROR',
    )
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(
      await AiActionService.update('u1', 'ws1', 'c2', { name: 'a' }),
      'FORBIDDEN',
    )
  })
})

describe('AiActionService.remove', () => {
  it('should delete and audit', async () => {
    connectors.findById.mockResolvedValue(ok(ACTION))
    connectors.delete.mockResolvedValue(ok(true))
    expect(expectOk(await AiActionService.remove('u1', 'ws1', 'c2'))).toBe(true)
  })

  it('should fail on authz, missing and database errors', async () => {
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(await AiActionService.remove('u1', 'ws1', 'c2'), 'FORBIDDEN')
    privileged.mockResolvedValue(ok(MEMBERSHIP))
    connectors.findById.mockResolvedValue(ok(null))
    expectErr(
      await AiActionService.remove('u1', 'ws1', 'c2'),
      'AI_ACTION_CONNECTOR_NOT_FOUND',
    )
    connectors.findById.mockResolvedValue(ok(ACTION))
    connectors.delete.mockResolvedValue(err(databaseError()))
    expectErr(await AiActionService.remove('u1', 'ws1', 'c2'), 'DATABASE_ERROR')
  })
})

describe('AiActionService.updateSettings', () => {
  beforeEach(() => {
    settings.upsert.mockResolvedValue(
      ok(createFakeAiActionSettings({ enabled: true })),
    )
  })

  it('should save the switch, the allow-list and the identity', async () => {
    const saved = expectOk(
      await AiActionService.updateSettings('u1', 'ws1', {
        enabled: true,
        zapTools: [{ toolName: 'act_run', mode: 'APPROVAL' }],
        zapActorId: 'u2',
      }),
    )
    expect(saved.enabled).toBe(true)
    expect(settings.upsert).toHaveBeenCalledWith('ws1', {
      enabled: true,
      zapTools: [{ toolName: 'act_run', mode: 'APPROVAL' }],
      zapActorId: 'u2',
    })
  })

  it('should clear the identity and accept an empty allow-list', async () => {
    expectOk(
      await AiActionService.updateSettings('u1', 'ws1', {
        zapTools: [],
        zapActorId: null,
      }),
    )
    expect(settings.upsert).toHaveBeenCalledWith('ws1', {
      zapTools: [],
      zapActorId: null,
    })
  })

  it('should refuse unknown tools and non-admin identities', async () => {
    expectErr(
      await AiActionService.updateSettings('u1', 'ws1', {
        zapTools: [{ toolName: 'nope', mode: 'AUTO' }],
      }),
      'AI_ACTION_CONNECTOR_INVALID',
    )
    privileged.mockResolvedValueOnce(ok(MEMBERSHIP))
    privileged.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await AiActionService.updateSettings('u1', 'ws1', { zapActorId: 'u9' }),
      'AI_ACTION_CONNECTOR_INVALID',
    )
  })

  it('should fail on authz and database errors', async () => {
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(
      await AiActionService.updateSettings('u1', 'ws1', { enabled: true }),
      'FORBIDDEN',
    )
    privileged.mockResolvedValue(ok(MEMBERSHIP))
    settings.upsert.mockResolvedValue(err(databaseError()))
    expectErr(
      await AiActionService.updateSettings('u1', 'ws1', { enabled: true }),
      'DATABASE_ERROR',
    )
  })
})

describe('AiActionService.zapConfig', () => {
  it('should read the config and default to off', async () => {
    settings.find.mockResolvedValueOnce(ok(null))
    expect(expectOk(await AiActionService.zapConfig('ws1'))).toEqual({
      enabled: false,
      tools: [],
      actorId: null,
    })
    settings.find.mockResolvedValueOnce(
      ok(
        createFakeAiActionSettings({
          zapTools: [{ toolName: 'act_run', mode: 'AUTO' }],
          zapActorId: 'u1',
        }),
      ),
    )
    expect(expectOk(await AiActionService.zapConfig('ws1')).actorId).toBe('u1')
    settings.find.mockResolvedValueOnce(err(databaseError()))
    expectErr(await AiActionService.zapConfig('ws1'), 'DATABASE_ERROR')
  })
})

describe('AiActionService.listForAi / describe', () => {
  it('should list only enabled connectors while the switch is on', async () => {
    connectors.listByWorkspace.mockResolvedValue(
      ok([LOOKUP, createFakeAiActionConnector({ enabled: false, key: 'off' })]),
    )
    const list = expectOk(await AiActionService.listForAi(CTX))
    expect(list.map((c) => c.key)).toEqual(['consultar_pedido'])
  })

  it('should be closed when the switch is off, for strangers and on errors', async () => {
    settings.find.mockResolvedValue(ok(null))
    expectErr(await AiActionService.listForAi(CTX), 'AI_ACTIONS_DISABLED')
    expectErr(
      await AiActionService.describe(CTX, 'x', 'LOOKUP'),
      'AI_ACTIONS_DISABLED',
    )
    settings.find.mockResolvedValue(err(databaseError()))
    expectErr(await AiActionService.listForAi(CTX), 'DATABASE_ERROR')
    member.mockResolvedValue(err(forbidden()))
    expectErr(await AiActionService.listForAi(CTX), 'FORBIDDEN')
    expectErr(await AiActionService.describe(CTX, 'x', 'LOOKUP'), 'FORBIDDEN')
    member.mockResolvedValue(ok(MEMBERSHIP))
    settings.find.mockResolvedValue(
      ok(createFakeAiActionSettings({ enabled: true })),
    )
    connectors.listByWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(await AiActionService.listForAi(CTX), 'DATABASE_ERROR')
  })

  it('should describe only an enabled connector of the right kind', async () => {
    connectors.findByKey.mockResolvedValue(ok(ACTION))
    expectOk(await AiActionService.describe(CTX, 'redefinir_senha', 'ACTION'))
    expectErr(
      await AiActionService.describe(CTX, 'redefinir_senha', 'LOOKUP'),
      'AI_ACTION_CONNECTOR_NOT_FOUND',
    )
    connectors.findByKey.mockResolvedValue(
      ok(createFakeAiActionConnector({ enabled: false })),
    )
    expectErr(
      await AiActionService.describe(CTX, 'x', 'LOOKUP'),
      'AI_ACTION_CONNECTOR_NOT_FOUND',
    )
    connectors.findByKey.mockResolvedValue(ok(null))
    expectErr(
      await AiActionService.describe(CTX, 'x', 'LOOKUP'),
      'AI_ACTION_CONNECTOR_NOT_FOUND',
    )
    connectors.findByKey.mockResolvedValue(err(databaseError()))
    expectErr(
      await AiActionService.describe(CTX, 'x', 'LOOKUP'),
      'DATABASE_ERROR',
    )
  })
})

describe('AiActionService.invoke — lookup', () => {
  beforeEach(() => {
    connectors.findByKey.mockResolvedValue(ok(LOOKUP))
  })

  it('should call the system without an idempotency key', async () => {
    call.mockResolvedValue(
      ok({ ok: true, status: 200, body: { status: 'ENVIADO' } }),
    )
    const out = expectOk(
      await AiActionService.invoke(
        CTX,
        { connector: 'consultar_pedido', params: { orderId: '55' } },
        'LOOKUP',
      ),
    )
    expect(out.data).toEqual({ status: 200, response: { status: 'ENVIADO' } })
    expect(call.mock.calls[0]?.[0].idempotencyKey).toBeNull()
    expect(call.mock.calls[0]?.[0].request.url).toContain('/pedidos/55')
    expect(executions.claim).not.toHaveBeenCalled()
  })

  it('should surface HTTP errors, network errors and bad arguments', async () => {
    call.mockResolvedValue(ok({ ok: false, status: 404, body: null }))
    expectErr(
      await AiActionService.invoke(
        CTX,
        { connector: 'consultar_pedido', params: { orderId: '55' } },
        'LOOKUP',
      ),
      'AI_ACTION_CONNECTOR_FAILED',
    )
    call.mockResolvedValue(err(aiActionConnectorFailed('down')))
    expectErr(
      await AiActionService.invoke(
        CTX,
        { connector: 'consultar_pedido', params: { orderId: '55' } },
        'LOOKUP',
      ),
      'AI_ACTION_CONNECTOR_FAILED',
    )
    expectErr(
      await AiActionService.invoke(
        CTX,
        { connector: 'consultar_pedido', params: {} },
        'LOOKUP',
      ),
      'AI_ACTION_CONNECTOR_INVALID',
    )
  })

  it('should fail when the connector cannot be described', async () => {
    connectors.findByKey.mockResolvedValue(ok(null))
    expectErr(
      await AiActionService.invoke(
        CTX,
        { connector: 'x', params: {} },
        'LOOKUP',
      ),
      'AI_ACTION_CONNECTOR_NOT_FOUND',
    )
  })
})

describe('AiActionService.invoke — action', () => {
  const input = { connector: 'redefinir_senha', params: { email: 'a@b.com' } }
  const NOW = new Date('2026-10-30T12:00:00Z')

  beforeEach(() => {
    connectors.findByKey.mockResolvedValue(ok(ACTION))
    executions.complete.mockResolvedValue(ok(true))
  })

  it('should claim the key, send it and store the outcome', async () => {
    executions.claim.mockResolvedValue(ok({ kind: 'claimed', id: 'e1' }))
    call.mockResolvedValue(ok({ ok: true, status: 200, body: { sent: true } }))
    const out = expectOk(
      await AiActionService.invoke(CTX, input, 'ACTION', { now: NOW }),
    )
    expect(out.summary).toContain('executada')
    const sent = call.mock.calls[0]?.[0]
    expect(sent?.idempotencyKey).toMatch(/^[a-f0-9]{64}$/)
    expect(sent?.headers).toEqual({ Authorization: 'Bearer t' })
    expect(executions.claim).toHaveBeenCalledWith(
      'ws1',
      sent?.idempotencyKey,
      'redefinir_senha',
      {
        staleBefore: new Date('2026-10-30T11:58:00Z'),
        replayBefore: new Date('2026-10-29T12:00:00Z'),
      },
    )
    expect(executions.complete).toHaveBeenCalledWith('e1', {
      status: 'SUCCESS',
      httpStatus: 200,
      response: { sent: true },
    })
  })

  it('should record a failure and let the next try repeat the call', async () => {
    executions.claim.mockResolvedValue(ok({ kind: 'claimed', id: 'e1' }))
    call.mockResolvedValue(ok({ ok: false, status: 500, body: null }))
    expectErr(
      await AiActionService.invoke(CTX, input, 'ACTION'),
      'AI_ACTION_CONNECTOR_FAILED',
    )
    expect(executions.complete).toHaveBeenCalledWith('e1', {
      status: 'FAILURE',
      httpStatus: 500,
      response: null,
    })
    call.mockResolvedValue(err(aiActionConnectorFailed('down')))
    expectErr(
      await AiActionService.invoke(CTX, input, 'ACTION'),
      'AI_ACTION_CONNECTOR_FAILED',
    )
    expect(executions.complete).toHaveBeenLastCalledWith('e1', {
      status: 'FAILURE',
      httpStatus: null,
      response: null,
    })
  })

  it('should replay a stored success without calling the system', async () => {
    executions.claim.mockResolvedValue(
      ok({ kind: 'existing', row: createFakeAiActionExecution() }),
    )
    const out = expectOk(await AiActionService.invoke(CTX, input, 'ACTION'))
    expect(out.data).toMatchObject({ replayed: true, status: 200 })
    expect(call).not.toHaveBeenCalled()
  })

  it('should refuse while the same write is still running', async () => {
    executions.claim.mockResolvedValue(
      ok({
        kind: 'existing',
        row: createFakeAiActionExecution({ status: 'PENDING' }),
      }),
    )
    expectErr(
      await AiActionService.invoke(CTX, input, 'ACTION'),
      'AI_ACTION_IN_PROGRESS',
    )
    expect(call).not.toHaveBeenCalled()
  })

  it('should propagate ledger errors and survive a failed ledger update', async () => {
    executions.claim.mockResolvedValue(err(databaseError()))
    expectErr(
      await AiActionService.invoke(CTX, input, 'ACTION'),
      'DATABASE_ERROR',
    )
    executions.claim.mockResolvedValue(ok({ kind: 'claimed', id: 'e1' }))
    executions.complete.mockResolvedValue(err(databaseError()))
    call.mockResolvedValue(ok({ ok: true, status: 200, body: null }))
    expectOk(await AiActionService.invoke(CTX, input, 'ACTION'))
  })

  it('should scope the key by agent, then conversation, then nothing', async () => {
    executions.claim.mockResolvedValue(ok({ kind: 'claimed', id: 'e1' }))
    call.mockResolvedValue(ok({ ok: true, status: 200, body: null }))
    const keys: string[] = []
    for (const ctx of [
      CTX,
      { ...CTX, agentId: undefined, conversationId: 'conv1' },
      { ...CTX, agentId: undefined },
    ]) {
      await AiActionService.invoke(ctx, input, 'ACTION')
      keys.push(executions.claim.mock.calls.at(-1)?.[1] as string)
    }
    expect(new Set(keys).size).toBe(3)
  })
})
