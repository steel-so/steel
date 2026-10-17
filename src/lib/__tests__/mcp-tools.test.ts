import { describe, expect, it, vi } from 'vitest'
import { validationError } from '@/src/errors/app-error'
import { STEEL_AI_TOOLS } from '@/src/lib/ai/tools'
import {
  callMcpTool,
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

  it('should never expose writes in wave 1, even with mcp:write', () => {
    const grant = mcpGrant({ scopes: ['mcp:read', 'mcp:write'] })
    expect(mcpAllowedKinds(grant)).toEqual(['READ'])
    expect(isMcpToolExposed(sdCreate, grant, mcpAccess())).toBe(false)
    expect(
      isMcpToolExposed(sdDelete, grant, mcpAccess({ isPrivileged: true })),
    ).toBe(false)
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

  it('should keep the real registry READ-only and DELETE-free', () => {
    const exposed = mcpTools(
      STEEL_AI_TOOLS,
      mcpGrant({ scopes: ['mcp:read', 'mcp:write'] }),
      mcpAccess({ isPrivileged: true }),
    )
    expect(exposed.length).toBeGreaterThan(0)
    expect(exposed.every((t) => t.kind === 'READ')).toBe(true)
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

    const result = await callMcpTool(tool, mcpGrant(), {
      workspaceId: 'other',
      q: 'x',
    })

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
    await callMcpTool(fakeTool({ parse }), mcpGrant(), undefined)
    expect(parse).toHaveBeenCalledWith({})
  })

  it('should cap the output and flag it as truncated', async () => {
    const big = 'x'.repeat(50_000)
    const tool = fakeTool({
      execute: vi.fn(async () => ok({ data: { big }, summary: 'grande' })),
    })

    const result = await callMcpTool(tool, mcpGrant(), {})

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
    expect(await callMcpTool(tool, mcpGrant(), {})).toEqual({
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
    expect((await callMcpTool(failing, mcpGrant(), {})).isError).toBe(true)

    const throwing = fakeTool({
      execute: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    const result = await callMcpTool(throwing, mcpGrant(), {})
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toEqual({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Falha inesperada ao executar a ferramenta',
      },
    })
  })

  it('should refuse a write tool even if called directly', async () => {
    const result = await callMcpTool(sdCreate, mcpGrant(), {})
    expect(result.isError).toBe(true)
    expect(sdCreate.execute).not.toHaveBeenCalled()
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
