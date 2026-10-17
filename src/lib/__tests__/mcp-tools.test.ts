import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeAiPendingAction } from '@/src/__tests__/factories/steel-ai.factory'
import { databaseError } from '@/src/errors'
import { forbidden, validationError } from '@/src/errors/app-error'
import { STEEL_AI_TOOLS } from '@/src/lib/ai/tools'
import {
  absolutizeHrefs,
  callMcpTool,
  IDEMPOTENCY_KEY_ARG,
  isMcpToolExposed,
  mcpAllowedKinds,
  mcpToolContext,
  mcpToolError,
  mcpTools,
  toMcpTool,
} from '@/src/lib/mcp/tools'
import { err, ok } from '@/src/lib/result'
import { fakeTool, mcpAccess, mcpGrant } from './mcp.fixtures'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/services/ai-pending-action.service', () => ({
  executeMcpWrite: vi.fn(),
  proposeMcpWrite: vi.fn(),
}))
vi.mock('@/src/cache/mcp-idempotency.cache', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/src/cache/mcp-idempotency.cache')>()
  return {
    ...actual,
    McpIdempotencyCache: {
      claim: vi.fn(),
      complete: vi.fn(),
      release: vi.fn(),
    },
  }
})

import { McpIdempotencyCache } from '@/src/cache/mcp-idempotency.cache'
import {
  executeMcpWrite,
  proposeMcpWrite,
} from '@/src/services/ai-pending-action.service'

const ORIGIN = 'https://steel.example.com/'
const OPTS = { origin: ORIGIN }
const idem = vi.mocked(McpIdempotencyCache)
const mockedExecute = vi.mocked(executeMcpWrite)
const mockedPropose = vi.mocked(proposeMcpWrite)

beforeEach(() => {
  vi.clearAllMocks()
  idem.claim.mockResolvedValue({ status: 'claimed' })
})

const sdRead = fakeTool({ name: 'sd_list', module: 'SERVICE_DESK' })
const crmRead = fakeTool({
  name: 'crm_list',
  module: 'CRM',
  permission: { resource: 'leads', action: 'VIEW' },
})
const zapRead = fakeTool({
  name: 'zap_list',
  module: 'COMMUNICATION',
  permission: { resource: 'conversations', action: 'VIEW' },
})
const platformRead = fakeTool({ name: 'ws_overview' })
const sdCreate = fakeTool({
  name: 'sd_create',
  module: 'SERVICE_DESK',
  kind: 'CREATE',
  preview: vi.fn(async () => ok({ title: 't', summary: 's' })),
})
const sdDelete = fakeTool({
  name: 'sd_delete',
  module: 'SERVICE_DESK',
  kind: 'DELETE',
  preview: vi.fn(async () => ok({ title: 't', summary: 's' })),
})
const TOOLS = [sdRead, crmRead, zapRead, platformRead, sdCreate, sdDelete]
const names = (tools: { name: string }[]) => tools.map((t) => t.name)

describe('mcpTools()', () => {
  it('should expose only READ tools of granted modules the user can use', () => {
    expect(names(mcpTools(TOOLS, mcpGrant(), mcpAccess()))).toEqual([
      'sd_list',
      'crm_list',
      'ws_overview',
    ])
  })

  it('should expose writes only with mcp:write AND the admin switch', () => {
    const writer = mcpGrant({ scopes: ['mcp:read', 'mcp:write'] })
    const reader = mcpGrant()
    const on = mcpAccess({ mcpWriteEnabled: true })

    expect(mcpAllowedKinds(writer, on)).toEqual([
      'READ',
      'CREATE',
      'UPDATE',
      'ACTION',
    ])
    expect(mcpAllowedKinds(writer, mcpAccess())).toEqual(['READ'])
    expect(mcpAllowedKinds(reader, on)).toEqual(['READ'])

    expect(isMcpToolExposed(sdCreate, writer, on)).toBe(true)
    expect(isMcpToolExposed(sdCreate, writer, mcpAccess())).toBe(false)
    expect(isMcpToolExposed(sdCreate, reader, on)).toBe(false)
  })

  it('should not depend on the in-app agent mode or Autopilot', () => {
    const writer = mcpGrant({ scopes: ['mcp:read', 'mcp:write'] })
    const access = mcpAccess({
      mcpWriteEnabled: true,
      agentModeEnabled: false,
      autopilotEnabled: false,
    })
    expect(isMcpToolExposed(sdCreate, writer, access)).toBe(true)
  })

  it('should never expose DELETE, whatever the scopes and role', () => {
    const writer = mcpGrant({ scopes: ['mcp:read', 'mcp:write'] })
    expect(
      isMcpToolExposed(
        sdDelete,
        writer,
        mcpAccess({ isPrivileged: true, mcpWriteEnabled: true }),
      ),
    ).toBe(false)
  })

  it('should apply the RBAC matrix to writes too', () => {
    const writer = mcpGrant({ scopes: ['mcp:read', 'mcp:write'] })
    const crmCreate = fakeTool({
      name: 'crm_create',
      module: 'CRM',
      kind: 'CREATE',
      permission: { resource: 'leads', action: 'CREATE' },
    })
    expect(
      isMcpToolExposed(crmCreate, writer, mcpAccess({ mcpWriteEnabled: true })),
    ).toBe(false)
    expect(
      isMcpToolExposed(
        crmCreate,
        writer,
        mcpAccess({ mcpWriteEnabled: true, isPrivileged: true }),
      ),
    ).toBe(true)
  })

  it('should drop tools of modules left out of the consent', () => {
    expect(
      names(mcpTools(TOOLS, mcpGrant({ modules: ['CRM'] }), mcpAccess())),
    ).toEqual(['crm_list', 'ws_overview'])
  })

  it('should drop tools of modules disabled in the workspace since consent', () => {
    expect(
      names(mcpTools(TOOLS, mcpGrant(), mcpAccess({ modules: ['CRM'] }))),
    ).toEqual(['crm_list', 'ws_overview'])
  })

  it('should apply the RBAC matrix, and let OWNER/ADMIN bypass it', () => {
    expect(
      names(mcpTools(TOOLS, mcpGrant(), mcpAccess({ permissions: null }))),
    ).toEqual(['sd_list', 'ws_overview'])
    expect(
      names(mcpTools(TOOLS, mcpGrant(), mcpAccess({ isPrivileged: true }))),
    ).toEqual(['sd_list', 'crm_list', 'zap_list', 'ws_overview'])
  })

  it('should expose nothing when the workspace turned Steel AI off', () => {
    expect(
      mcpTools(TOOLS, mcpGrant(), mcpAccess({ aiEnabled: false })),
    ).toEqual([])
  })

  it('should keep the real registry READ-only without the switch', () => {
    const exposed = mcpTools(
      STEEL_AI_TOOLS,
      mcpGrant({ scopes: ['mcp:read', 'mcp:write'] }),
      mcpAccess({ isPrivileged: true }),
    )
    expect(exposed.length).toBeGreaterThan(0)
    expect(exposed.every((t) => t.kind === 'READ')).toBe(true)
  })

  it('should expose real writes but never a DELETE with the switch on', () => {
    const exposed = mcpTools(
      STEEL_AI_TOOLS,
      mcpGrant({ scopes: ['mcp:read', 'mcp:write'] }),
      mcpAccess({ isPrivileged: true, mcpWriteEnabled: true }),
    )
    expect(exposed.some((t) => t.kind !== 'READ')).toBe(true)
    expect(exposed.some((t) => t.kind === 'DELETE')).toBe(false)
    expect(exposed.some((t) => t.customerFacing)).toBe(true)
  })
})

describe('toMcpTool()', () => {
  it('should map label, schema and default annotations', () => {
    expect(toMcpTool(sdRead)).toEqual({
      name: 'sd_list',
      title: 'Ferramenta',
      description: 'd',
      inputSchema: { type: 'object', properties: {} },
      annotations: {
        title: 'Ferramenta',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    })
    expect(toMcpTool(sdDelete).annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    })
  })

  it('should prefer the hints a tool declares', () => {
    const hinted = {
      ...sdCreate,
      annotations: {
        idempotentHint: true,
        destructiveHint: true,
        openWorldHint: true,
      },
    }
    expect(toMcpTool(hinted).annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    })
  })
})

describe('callMcpTool()', () => {
  it('should run with the grant identity, never the arguments', async () => {
    const execute = vi.fn(async () => ok({ data: [1, 2], summary: '2 itens' }))
    const tool = fakeTool({ name: 'sd_list', execute })

    const result = await callMcpTool(
      tool,
      mcpGrant(),
      { workspaceId: 'other', q: 'x' },
      OPTS,
    )

    expect(execute).toHaveBeenCalledWith(
      {
        workspaceId: 'ws1',
        actorId: 'u1',
        source: 'mcp',
        oauthClientId: 'client1',
      },
      { workspaceId: 'other', q: 'x' },
    )
    expect(result).toEqual({
      content: [
        { type: 'text', text: '2 itens' },
        {
          type: 'text',
          text: JSON.stringify({ summary: '2 itens', data: [1, 2] }),
        },
      ],
      structuredContent: { summary: '2 itens', data: [1, 2] },
    })
  })

  it('should pass empty arguments when the client sends none', async () => {
    const parse = vi.fn((args: Record<string, unknown>) => ok(args))
    await callMcpTool(fakeTool({ parse }), mcpGrant(), undefined, OPTS)
    expect(parse).toHaveBeenCalledWith({})
  })

  it('should cap the output and flag it as truncated', async () => {
    const big = 'x'.repeat(50_000)
    const tool = fakeTool({
      execute: vi.fn(async () => ok({ data: { big }, summary: 'grande' })),
    })

    const result = await callMcpTool(tool, mcpGrant(), {}, OPTS)

    const structured = result.structuredContent as Record<string, unknown>
    expect(structured.truncated).toBe(true)
    expect(typeof structured.data).toBe('string')
    expect(String(structured.note)).toContain('truncado')
    const text = (result.content[1] as { text: string }).text
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(21_000)
  })

  it('should turn a parse error into an isError result', async () => {
    const tool = fakeTool({
      parse: () => err(validationError('Parâmetros inválidos')),
    })
    expect(await callMcpTool(tool, mcpGrant(), {}, OPTS)).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Parâmetros inválidos' }],
      structuredContent: {
        error: { code: 'VALIDATION_ERROR', message: 'Parâmetros inválidos' },
      },
    })
  })

  it('should turn a domain error and a thrown error into isError results', async () => {
    const failing = fakeTool({
      execute: vi.fn(async () => err(validationError('Sem acesso'))),
    })
    expect((await callMcpTool(failing, mcpGrant(), {}, OPTS)).isError).toBe(
      true,
    )

    const throwing = fakeTool({
      execute: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    const result = await callMcpTool(throwing, mcpGrant(), {}, OPTS)
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toEqual({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Falha inesperada ao executar a ferramenta',
      },
    })
  })

  it('should make relative hrefs absolute in read results', async () => {
    const tool = fakeTool({
      execute: vi.fn(async () =>
        ok({
          data: { items: [{ href: '/demo/servicedesk/tickets/42' }] },
          summary: '1 chamado',
        }),
      ),
    })
    const result = await callMcpTool(tool, mcpGrant(), {}, OPTS)
    expect(result.structuredContent).toEqual({
      summary: '1 chamado',
      data: {
        items: [
          { href: 'https://steel.example.com/demo/servicedesk/tickets/42' },
        ],
      },
    })
  })
})

const writer = mcpGrant({ scopes: ['mcp:read', 'mcp:write'] })
const zapSend = fakeTool({
  name: 'zap_message_send_text',
  label: 'Enviando mensagem',
  module: 'COMMUNICATION',
  kind: 'ACTION',
  customerFacing: true,
  annotations: { destructiveHint: false, openWorldHint: true },
  preview: vi.fn(),
})

function executedRun(data: unknown = { id: 't1' }) {
  return ok({
    action: createFakeAiPendingAction({ id: 'act1', status: 'EXECUTED' }),
    run: {
      ok: true as const,
      output: {
        data,
        summary: 'Chamado criado',
        target: {
          type: 'sd_ticket',
          id: 't1',
          href: '/demo/servicedesk/tickets/7',
        },
      },
      content: JSON.stringify({
        status: 'done',
        summary: 'Chamado criado',
        data,
      }),
    },
  })
}

describe('callMcpTool() — writes', () => {
  it('should run a non customer-facing write at once, with absolute links', async () => {
    mockedExecute.mockResolvedValue(executedRun())

    const result = await callMcpTool(sdCreate, writer, { title: 'x' }, OPTS)

    expect(mockedExecute).toHaveBeenCalledWith(
      sdCreate,
      mcpToolContext(writer),
      { title: 'x' },
      { integrationGrantId: 'g1' },
    )
    expect(mockedPropose).not.toHaveBeenCalled()
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual({
      status: 'executed',
      summary: 'Chamado criado',
      actionId: 'act1',
      target: {
        type: 'sd_ticket',
        id: 't1',
        href: 'https://steel.example.com/demo/servicedesk/tickets/7',
      },
      data: { id: 't1' },
    })
    // No key: no idempotency bookkeeping.
    expect(idem.claim).not.toHaveBeenCalled()
  })

  it('should turn execution and service failures into isError results', async () => {
    mockedExecute.mockResolvedValue(
      ok({
        action: createFakeAiPendingAction({ status: 'FAILED' }),
        run: {
          ok: false as const,
          error: forbidden('Sem permissão'),
          content: '{}',
        },
      }),
    )
    const failed = await callMcpTool(sdCreate, writer, {}, OPTS)
    expect(failed.isError).toBe(true)
    expect(failed.structuredContent).toEqual({
      error: { code: 'FORBIDDEN', message: 'Sem permissão' },
    })

    mockedExecute.mockResolvedValue(err(databaseError()))
    expect((await callMcpTool(sdCreate, writer, {}, OPTS)).isError).toBe(true)
  })

  it('should only propose a customer-facing write and return the confirm link', async () => {
    mockedPropose.mockResolvedValue(
      ok({
        action: createFakeAiPendingAction({
          id: 'act9',
          preview: {
            title: 'Enviar mensagem para Ana',
            summary: 'Olá',
            target: {
              type: 'zap_conversation',
              label: 'Ana',
              href: '/demo/zap/c1',
            },
          },
          expiresAt: new Date('2026-10-17T12:30:00.000Z'),
        }),
        confirmPath: '/demo/inbox?view=ai&action=act9',
      }),
    )

    const result = await callMcpTool(zapSend, writer, { text: 'Olá' }, OPTS)

    expect(mockedExecute).not.toHaveBeenCalled()
    expect(zapSend.execute).not.toHaveBeenCalled()
    const structured = result.structuredContent as Record<string, unknown>
    expect(structured).toMatchObject({
      status: 'pending_confirmation',
      actionId: 'act9',
      confirmUrl: 'https://steel.example.com/demo/inbox?view=ai&action=act9',
      expiresAt: '2026-10-17T12:30:00.000Z',
      preview: {
        target: { href: 'https://steel.example.com/demo/zap/c1' },
      },
    })
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('Nada foi feito ainda')
    expect(text).toContain(
      'https://steel.example.com/demo/inbox?view=ai&action=act9',
    )
  })

  it('should report a failed proposal as isError', async () => {
    mockedPropose.mockResolvedValue(err(forbidden('Sem acesso')))
    expect((await callMcpTool(zapSend, writer, {}, OPTS)).isError).toBe(true)
  })

  it('should strip the idempotency key and store the result under it', async () => {
    mockedExecute.mockResolvedValue(executedRun())

    const result = await callMcpTool(
      sdCreate,
      writer,
      { title: 'x', [IDEMPOTENCY_KEY_ARG]: 'k-1' },
      OPTS,
    )

    const scope = { grantId: 'g1', toolName: 'sd_create', key: 'k-1' }
    expect(mockedExecute.mock.calls[0][2]).toEqual({ title: 'x' })
    expect(idem.claim).toHaveBeenCalledWith(scope, expect.any(String))
    expect(idem.complete).toHaveBeenCalledWith(
      scope,
      idem.claim.mock.calls[0][1],
      result,
    )
    expect(idem.release).not.toHaveBeenCalled()
  })

  it('should replay a finished key without running again', async () => {
    const stored = { content: [{ type: 'text', text: 'antes' }] }
    idem.claim.mockResolvedValue({ status: 'replay', result: stored })

    const result = await callMcpTool(
      sdCreate,
      writer,
      { [IDEMPOTENCY_KEY_ARG]: 'k-1' },
      OPTS,
    )

    expect(result).toEqual(stored)
    expect(mockedExecute).not.toHaveBeenCalled()
  })

  it('should refuse a key in progress or reused with other arguments', async () => {
    idem.claim.mockResolvedValue({ status: 'in_progress' })
    const running = await callMcpTool(
      sdCreate,
      writer,
      { [IDEMPOTENCY_KEY_ARG]: 'k-1' },
      OPTS,
    )
    expect(running.structuredContent).toMatchObject({
      error: { code: 'MCP_IDEMPOTENCY_IN_PROGRESS' },
    })

    idem.claim.mockResolvedValue({ status: 'mismatch' })
    const reused = await callMcpTool(
      sdCreate,
      writer,
      { [IDEMPOTENCY_KEY_ARG]: 'k-1' },
      OPTS,
    )
    expect(reused.structuredContent).toMatchObject({
      error: { code: 'MCP_IDEMPOTENCY_KEY_REUSED' },
    })
    expect(mockedExecute).not.toHaveBeenCalled()
  })

  it('should release the key when the write failed, so a retry runs', async () => {
    mockedExecute.mockResolvedValue(err(databaseError()))
    await callMcpTool(sdCreate, writer, { [IDEMPOTENCY_KEY_ARG]: 'k-1' }, OPTS)
    expect(idem.release).toHaveBeenCalledWith({
      grantId: 'g1',
      toolName: 'sd_create',
      key: 'k-1',
    })
    expect(idem.complete).not.toHaveBeenCalled()
  })

  it('should run without dedupe when Redis is unavailable', async () => {
    idem.claim.mockResolvedValue({ status: 'unavailable' })
    mockedExecute.mockResolvedValue(executedRun())
    const result = await callMcpTool(
      sdCreate,
      writer,
      { [IDEMPOTENCY_KEY_ARG]: 'k-1' },
      OPTS,
    )
    expect(result.isError).toBeUndefined()
  })

  it.each([
    ['empty', '  '],
    ['not a string', 42],
    ['too long', 'x'.repeat(201)],
  ])('should reject an idempotency key that is %s', async (_label, key) => {
    const result = await callMcpTool(
      sdCreate,
      writer,
      { [IDEMPOTENCY_KEY_ARG]: key },
      OPTS,
    )
    expect(result.structuredContent).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    })
    expect(mockedExecute).not.toHaveBeenCalled()
  })

  it('should ignore a null idempotency key', async () => {
    mockedExecute.mockResolvedValue(executedRun())
    await callMcpTool(sdCreate, writer, { [IDEMPOTENCY_KEY_ARG]: null }, OPTS)
    expect(mockedExecute.mock.calls[0][2]).toEqual({})
    expect(idem.claim).not.toHaveBeenCalled()
  })
})

describe('toMcpTool() — writes', () => {
  it('should add the optional idempotency key to write schemas only', () => {
    const write = toMcpTool(sdCreate)
    expect(write.inputSchema.properties).toHaveProperty(IDEMPOTENCY_KEY_ARG)
    expect(write.inputSchema.required ?? []).not.toContain(IDEMPOTENCY_KEY_ARG)
    expect(toMcpTool(sdRead).inputSchema.properties).not.toHaveProperty(
      IDEMPOTENCY_KEY_ARG,
    )
    const bare = toMcpTool(
      fakeTool({ kind: 'UPDATE', parameters: { type: 'object' } }),
    )
    expect(Object.keys(bare.inputSchema.properties ?? {})).toEqual([
      IDEMPOTENCY_KEY_ARG,
    ])
  })

  it('should tell clients that customer-facing writes need confirmation', () => {
    expect(toMcpTool(zapSend).description).toContain('confirmUrl')
    expect(toMcpTool(sdCreate).description).toBe('d')
  })
})

describe('absolutizeHrefs()', () => {
  it('should prefix only single-slash href strings, at any depth', () => {
    expect(
      absolutizeHrefs(
        {
          href: '/a',
          list: [{ href: '/b' }, { href: 'https://x.dev/c' }],
          other: { href: '//evil.dev/d', path: '/e', n: 1 },
          nested: { href: 7 },
        },
        'https://steel.example.com/some/path',
      ),
    ).toEqual({
      href: 'https://steel.example.com/a',
      list: [
        { href: 'https://steel.example.com/b' },
        { href: 'https://x.dev/c' },
      ],
      other: { href: '//evil.dev/d', path: '/e', n: 1 },
      nested: { href: 7 },
    })
    expect(absolutizeHrefs('texto', ORIGIN)).toBe('texto')
  })

  it('should stop at a safe depth', () => {
    let deep: Record<string, unknown> = { href: '/fundo' }
    for (let i = 0; i < 20; i++) deep = { child: deep }
    const out = JSON.stringify(absolutizeHrefs(deep, ORIGIN))
    expect(out).toContain('"href":"/fundo"')
  })
})

describe('helpers', () => {
  it('should build the tool context and the error result', () => {
    expect(mcpToolContext(mcpGrant({ clientId: 'c9' })).oauthClientId).toBe(
      'c9',
    )
    expect(mcpToolError({ code: 'FORBIDDEN', message: 'Não' }).isError).toBe(
      true,
    )
  })
})
