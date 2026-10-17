import { describe, expect, it, vi } from 'vitest'
import { handleMcpRequest, MCP_SERVER_NAME } from '@/src/lib/mcp/server'
import { ok } from '@/src/lib/result'
import { fakeTool, mcpAccess, mcpGrant } from './mcp.fixtures'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/services/sd-kb-article.service', () => ({
  SdKbArticleService: { list: vi.fn(), getById: vi.fn() },
}))
vi.mock('@/src/services/wiki-page.service', () => ({
  WikiPageService: { list: vi.fn(), getById: vi.fn() },
}))

vi.mock('@/src/services/ai-pending-action.service', () => ({
  executeMcpWrite: vi.fn(),
  proposeMcpWrite: vi.fn(),
}))

import { createFakeAiPendingAction } from '@/src/__tests__/factories/steel-ai.factory'
import { executeMcpWrite } from '@/src/services/ai-pending-action.service'
import { SdKbArticleService } from '@/src/services/sd-kb-article.service'
import { WikiPageService } from '@/src/services/wiki-page.service'

const sdRead = fakeTool({
  name: 'sd_list',
  label: 'Consultando chamados',
  module: 'SERVICE_DESK',
  execute: vi.fn(async () => ok({ data: { total: 3 }, summary: '3 chamados' })),
})
const sdCreate = fakeTool({
  name: 'sd_create',
  module: 'SERVICE_DESK',
  kind: 'CREATE',
  preview: vi.fn(async () => ok({ title: 't', summary: 's' })),
})
const tools = [sdRead, sdCreate]

let nextId = 1
async function rpc(method: string, params?: Record<string, unknown>) {
  const request = new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  })
  const response = await handleMcpRequest(request, mcpGrant(), mcpAccess(), {
    tools,
  })
  return { status: response.status, body: await response.json() }
}

describe('handleMcpRequest()', () => {
  it('should answer initialize with the Steel capabilities', async () => {
    const { status, body } = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    })
    expect(status).toBe(200)
    expect(body.result.serverInfo.name).toBe(MCP_SERVER_NAME)
    expect(body.result.capabilities).toMatchObject({
      tools: {},
      resources: {},
      prompts: {},
    })
    expect(body.result.instructions).toContain('Steel')
  })

  it('should list only the tools the grant can see', async () => {
    const { body } = await rpc('tools/list')
    expect(body.result.tools.map((t: { name: string }) => t.name)).toEqual([
      'sd_list',
    ])
    expect(body.result.tools[0].annotations.readOnlyHint).toBe(true)
  })

  it('should call a tool and return structured content', async () => {
    const { body } = await rpc('tools/call', { name: 'sd_list', arguments: {} })
    expect(body.result.structuredContent).toEqual({
      summary: '3 chamados',
      data: { total: 3 },
    })
    expect(body.result.content[0]).toEqual({ type: 'text', text: '3 chamados' })
  })

  it('should treat hidden tools like unknown ones', async () => {
    for (const name of ['sd_create', 'nope']) {
      const { body } = await rpc('tools/call', { name, arguments: {} })
      expect(body.error.code).toBe(-32602)
      expect(body.error.message).toContain(`Ferramenta desconhecida: ${name}`)
    }
    expect(sdCreate.execute).not.toHaveBeenCalled()
  })

  it('should serve resources, templates and prompts', async () => {
    vi.mocked(SdKbArticleService.list).mockResolvedValue(ok([]))
    vi.mocked(WikiPageService.list).mockResolvedValue(ok([]))

    const resources = await rpc('resources/list')
    expect(resources.body.result).toEqual({ resources: [] })

    const templates = await rpc('resources/templates/list')
    expect(templates.body.result.resourceTemplates).toHaveLength(2)

    const unknown = await rpc('resources/read', { uri: 'steel://x/1' })
    expect(unknown.body.error.code).toBe(-32002)

    const prompts = await rpc('prompts/list')
    expect(prompts.body.result.prompts).toHaveLength(3)

    const prompt = await rpc('prompts/get', {
      name: 'servicedesk_daily_summary',
    })
    expect(prompt.body.result.messages[0].role).toBe('user')
  })
})

describe('handleMcpRequest() — writes', () => {
  const writer = mcpGrant({ scopes: ['mcp:read', 'mcp:write'] })
  const access = mcpAccess({ mcpWriteEnabled: true })

  async function call(method: string, params?: Record<string, unknown>) {
    const request = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    })
    const response = await handleMcpRequest(request, writer, access, {
      tools,
      origin: 'https://steel.example.com',
    })
    return response.json()
  }

  it('should list writes with the idempotency key when allowed', async () => {
    const body = await call('tools/list')
    const create = body.result.tools.find(
      (t: { name: string }) => t.name === 'sd_create',
    )
    expect(create.annotations.readOnlyHint).toBe(false)
    expect(create.inputSchema.properties).toHaveProperty('idempotencyKey')
  })

  it('should route a write call through the MCP write flow', async () => {
    vi.mocked(executeMcpWrite).mockResolvedValue(
      ok({
        action: createFakeAiPendingAction({ id: 'act1' }),
        run: {
          ok: true as const,
          output: { data: { id: 't1' }, summary: 'Criado' },
          content: JSON.stringify({ status: 'done', data: { id: 't1' } }),
        },
      }),
    )
    const body = await call('tools/call', {
      name: 'sd_create',
      arguments: { title: 'x' },
    })
    expect(body.result.structuredContent).toMatchObject({
      status: 'executed',
      actionId: 'act1',
    })
  })
})
