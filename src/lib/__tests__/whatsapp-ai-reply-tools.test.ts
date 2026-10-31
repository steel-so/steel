import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit')
vi.mock('@/src/services/ai-action.service')
vi.mock('@/src/repositories/ai-action-log.repository')
vi.mock('@/src/lib/ai/tools/registry', () => ({
  findTool: vi.fn(),
  hasToolAccess: vi.fn(() => true),
  proposeWriteTool: vi.fn(),
  resolveToolAccess: vi.fn(),
  runReadTool: vi.fn(),
  runTool: vi.fn(),
  toToolSpecs: vi.fn((tools: { name: string }[]) =>
    tools.map((t) => ({ name: t.name })),
  ),
}))

import {
  findTool,
  hasToolAccess,
  proposeWriteTool,
  resolveToolAccess,
  runReadTool,
  runTool,
} from '@/src/lib/ai/tools/registry'
import { AiActionLogRepository } from '@/src/repositories/ai-action-log.repository'
import { AiActionService } from '@/src/services/ai-action.service'
import { loadZapAiTools } from '../whatsapp/ai-reply-tools'

const zapConfig = vi.mocked(AiActionService.zapConfig)
const access = vi.mocked(resolveToolAccess)
const find = vi.mocked(findTool)
const hasAccess = vi.mocked(hasToolAccess)
const readTool = vi.mocked(runReadTool)
const run = vi.mocked(runTool)
const propose = vi.mocked(proposeWriteTool)
const log = vi.mocked(AiActionLogRepository.create)

const TOOLS = {
  act_list_connectors: { name: 'act_list_connectors', kind: 'READ', module: null },
  act_lookup: { name: 'act_lookup', kind: 'READ', module: null },
  act_run: { name: 'act_run', kind: 'ACTION', module: null },
  sd_cancel_ticket: { name: 'sd_cancel_ticket', kind: 'DELETE', module: 'SERVICE_DESK' },
} as const

function config(tools: { toolName: string; mode: 'AUTO' | 'APPROVAL' }[]) {
  zapConfig.mockResolvedValue(ok({ enabled: true, tools, actorId: 'admin1' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  access.mockResolvedValue(
    ok({ aiEnabled: true, agentModeEnabled: true } as never),
  )
  find.mockImplementation(
    (name: string) => TOOLS[name as keyof typeof TOOLS] as never,
  )
  hasAccess.mockReturnValue(true)
  log.mockResolvedValue(ok({} as never))
})

const call = (name: string, tainted = false) => ({
  toolCall: { id: 'tc1', name, arguments: { connector: 'x', params: {} } },
  conversationId: 'conv1',
  tainted,
})

describe('loadZapAiTools', () => {
  it('should be off when the switch, the identity or the list is missing', async () => {
    zapConfig.mockResolvedValue(
      ok({ enabled: false, tools: [], actorId: 'a' }),
    )
    expect(await loadZapAiTools('ws1')).toBeNull()
    zapConfig.mockResolvedValue(ok({ enabled: true, tools: [], actorId: 'a' }))
    expect(await loadZapAiTools('ws1')).toBeNull()
    zapConfig.mockResolvedValue(
      ok({
        enabled: true,
        tools: [{ toolName: 'act_run', mode: 'AUTO' }],
        actorId: null,
      }),
    )
    expect(await loadZapAiTools('ws1')).toBeNull()
    zapConfig.mockResolvedValue(err(databaseError()))
    expect(await loadZapAiTools('ws1')).toBeNull()
  })

  it('should be off when the identity lost AI access', async () => {
    config([{ toolName: 'act_lookup', mode: 'AUTO' }])
    access.mockResolvedValue(err(databaseError()))
    expect(await loadZapAiTools('ws1')).toBeNull()
    access.mockResolvedValue(ok({ aiEnabled: false } as never))
    expect(await loadZapAiTools('ws1')).toBeNull()
  })

  it('should add the connector list next to any act_ tool', async () => {
    config([{ toolName: 'act_run', mode: 'APPROVAL' }])
    const tools = await loadZapAiTools('ws1')
    expect([...(tools?.names ?? [])].sort()).toEqual([
      'act_list_connectors',
      'act_run',
    ])
    expect(tools?.specs).toHaveLength(2)
  })

  it('should drop unknown tools, blocked ones and writes with agent mode off', async () => {
    config([
      { toolName: 'nope', mode: 'AUTO' },
      { toolName: 'act_lookup', mode: 'AUTO' },
      { toolName: 'sd_cancel_ticket', mode: 'AUTO' },
    ])
    hasAccess.mockImplementation((tool) => !tool.name.startsWith('act_'))
    access.mockResolvedValue(
      ok({ aiEnabled: true, agentModeEnabled: false } as never),
    )
    expect(await loadZapAiTools('ws1')).toBeNull()
    hasAccess.mockReturnValue(true)
    const tools = await loadZapAiTools('ws1')
    expect([...(tools?.names ?? [])].sort()).toEqual([
      'act_list_connectors',
      'act_lookup',
    ])
  })
})

describe('ZapAiTools.run', () => {
  it('should refuse tools outside the allow-list', async () => {
    config([{ toolName: 'act_lookup', mode: 'AUTO' }])
    const tools = await loadZapAiTools('ws1')
    const out = JSON.parse((await tools?.run(call('act_run'))) ?? '')
    expect(out.status).toBe('error')
    expect(out.error.code).toBe('AI_TOOL_NOT_ALLOWED')
  })

  it('should run reads with the configured identity', async () => {
    config([{ toolName: 'act_lookup', mode: 'AUTO' }])
    readTool.mockResolvedValue({ ok: true, content: 'READ', output: {} as never })
    const tools = await loadZapAiTools('ws1')
    expect(await tools?.run(call('act_lookup'))).toBe('READ')
    expect(readTool.mock.calls[0]?.[1]).toEqual({
      workspaceId: 'ws1',
      actorId: 'admin1',
      source: 'whatsapp',
      conversationId: 'conv1',
    })
  })

  it('should run an AUTO write, log it as WHATSAPP and audit', async () => {
    config([{ toolName: 'act_run', mode: 'AUTO' }])
    run.mockResolvedValue({
      ok: true,
      content: 'DONE',
      output: {
        data: {},
        summary: 'ok',
        target: { type: 'ai_action_connector', id: 'c1' },
      },
    })
    const tools = await loadZapAiTools('ws1')
    expect(await tools?.run(call('act_run'))).toBe('DONE')
    expect(log.mock.calls[0]?.[0]).toMatchObject({
      source: 'WHATSAPP',
      actorId: 'admin1',
      outcome: 'success',
      targetId: 'c1',
    })
    expect(propose).not.toHaveBeenCalled()
  })

  it('should log failures of an AUTO write and survive a log failure', async () => {
    config([{ toolName: 'act_run', mode: 'AUTO' }])
    run.mockResolvedValue({
      ok: false,
      content: 'FAIL',
      error: { code: 'AI_ACTION_CONNECTOR_FAILED', message: 'down' } as never,
    })
    log.mockResolvedValue(err(databaseError()))
    const tools = await loadZapAiTools('ws1')
    expect(await tools?.run(call('act_run'))).toBe('FAIL')
    expect(log.mock.calls[0]?.[0]).toMatchObject({
      outcome: 'failure',
      error: 'down',
      targetType: null,
    })
  })

  it.each([
    ['APPROVAL mode', 'APPROVAL' as const, false],
    ['a tainted conversation', 'AUTO' as const, true],
  ])('should propose instead of running with %s', async (_label, mode, tainted) => {
    config([{ toolName: 'act_run', mode }])
    propose.mockResolvedValue(ok({ id: 'pa1' } as never))
    const tools = await loadZapAiTools('ws1')
    const out = JSON.parse((await tools?.run(call('act_run', tainted))) ?? '')
    expect(out.status).toBe('pending_confirmation')
    expect(out.actionId).toBe('pa1')
    expect(run).not.toHaveBeenCalled()
  })

  it('should always propose deletes, even when saved as AUTO', async () => {
    config([{ toolName: 'sd_cancel_ticket', mode: 'AUTO' }])
    propose.mockResolvedValue(ok({ id: 'pa2' } as never))
    const tools = await loadZapAiTools('ws1')
    await tools?.run(call('sd_cancel_ticket'))
    expect(run).not.toHaveBeenCalled()
    expect(propose).toHaveBeenCalled()
  })

  it('should report a proposal that could not be stored', async () => {
    config([{ toolName: 'act_run', mode: 'APPROVAL' }])
    propose.mockResolvedValue(err(databaseError()))
    const tools = await loadZapAiTools('ws1')
    const out = JSON.parse((await tools?.run(call('act_run'))) ?? '')
    expect(out.status).toBe('error')
    expect(expectOk(ok(out)).error.code).toBe('DATABASE_ERROR')
  })
})
