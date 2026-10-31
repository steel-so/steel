import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSteelMcpServer } from '@/src/__tests__/factories/nov-ai-governance.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { appError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/steel-mcp-server.repository')
vi.mock('@/src/lib/steel-agents/mcp-client')
vi.mock('@/src/lib/crypto', () => ({
  decryptConnectionSecret: vi.fn(async (v: string) => `dec:${v}`),
}))
vi.mock('@/src/lib/ai/tools/registry', () => ({
  findTool: vi.fn((name: string) =>
    name === 'sd_list_tickets' ? { name } : undefined,
  ),
}))

import { decryptConnectionSecret } from '@/src/lib/crypto'
import { callMcpTool } from '@/src/lib/steel-agents/mcp-client'
import { SteelMcpServerRepository } from '@/src/repositories/steel-mcp-server.repository'
import {
  buildMcpTool,
  loadMcpAgentTools,
  resolveAgentTool,
} from '../steel-mcp-tools'

const repo = vi.mocked(SteelMcpServerRepository)
const call = vi.mocked(callMcpTool)
const CTX = { workspaceId: 'ws1', actorId: 'u1', source: 'agent' as const }

const server = createFakeSteelMcpServer({
  id: 's1',
  workspaceId: 'ws1',
  allowedTools: ['list_issues', 'create_issue'],
  encryptedAuthValue: 'secret',
})
const remote = (name: string) => {
  const found = (server.toolsCache as { name: string }[]).find(
    (t) => t.name === name,
  )
  return found as never
}

beforeEach(() => {
  repo.listByWorkspace.mockResolvedValue(ok([server]))
  repo.findById.mockResolvedValue(ok(server))
  call.mockResolvedValue(ok({ text: 'resultado', isError: false }))
})

describe('loadMcpAgentTools', () => {
  it('should expose only enabled servers and allow-listed tools, once each', async () => {
    repo.listByWorkspace.mockResolvedValue(
      ok([
        server,
        createFakeSteelMcpServer({
          slug: 'github',
          allowedTools: ['list_issues'],
        }),
        createFakeSteelMcpServer({
          slug: 'off',
          enabled: false,
          allowedTools: ['list_issues'],
        }),
      ]),
    )
    const tools = expectOk(await loadMcpAgentTools('ws1'))
    expect(tools.map((t) => t.name)).toEqual([
      'mcp_github__list_issues',
      'mcp_github__create_issue',
    ])
    expect(tools.map((t) => t.kind)).toEqual(['READ', 'ACTION'])
    expect(tools[0].module).toBeNull()
  })

  it('should hide tools that are not allow-listed and propagate errors', async () => {
    repo.listByWorkspace.mockResolvedValue(
      ok([createFakeSteelMcpServer({ allowedTools: [] })]),
    )
    expect(expectOk(await loadMcpAgentTools('ws1'))).toEqual([])
    repo.listByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(await loadMcpAgentTools('ws1'), 'DATABASE_ERROR')
  })
})

describe('resolveAgentTool', () => {
  it('should prefer the built-in registry and skip the database for it', async () => {
    expect(expectOk(await resolveAgentTool('ws1', 'sd_list_tickets'))).toEqual({
      name: 'sd_list_tickets',
    })
    expect(
      expectOk(await resolveAgentTool('ws1', 'unknown_tool')),
    ).toBeUndefined()
    expect(repo.listByWorkspace).not.toHaveBeenCalled()
  })

  it('should find an MCP tool or report it missing', async () => {
    expect(
      expectOk(await resolveAgentTool('ws1', 'mcp_github__create_issue'))?.name,
    ).toBe('mcp_github__create_issue')
    expect(
      expectOk(await resolveAgentTool('ws1', 'mcp_github__nope')),
    ).toBeUndefined()
    repo.listByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await resolveAgentTool('ws1', 'mcp_github__create_issue'),
      'DATABASE_ERROR',
    )
  })
})

describe('buildMcpTool', () => {
  it('should preview the call with the arguments', async () => {
    const tool = buildMcpTool(server, remote('create_issue'))
    const parsed = expectOk(tool.parse({ title: 'Bug', body: { a: 1 } }))
    const preview = expectOk((await tool.preview?.(CTX, parsed)) as never) as {
      title: string
      fields: { label: string; after: string }[]
      target: { label: string }
    }
    expect(preview.title).toBe('Chamar “create_issue” em GitHub')
    expect(preview.fields).toEqual([
      { label: 'title', after: 'Bug' },
      { label: 'body', after: '{"a":1}' },
    ])
    expect(preview.target.label).toBe('GitHub')
    expect(tool.annotations).toEqual({
      destructiveHint: true,
      openWorldHint: true,
    })
  })

  it('should describe a tool without a description and fix a non-object schema', async () => {
    const tool = buildMcpTool(server, {
      name: 'ping',
      description: '',
      inputSchema: { type: 'string' },
      readOnly: true,
    })
    expect(tool.parameters).toEqual({ type: 'object', properties: {} })
    expect(tool.description).toContain('ping')
    expect(tool.annotations?.destructiveHint).toBe(false)
    const preview = expectOk((await tool.preview?.(CTX, {})) as never) as {
      summary: string
    }
    expect(preview).toBeDefined()
  })

  it('should call the server with the decrypted secret and wrap the result as untrusted', async () => {
    const tool = buildMcpTool(server, remote('list_issues'))
    const output = expectOk(await tool.execute(CTX, { repo: 'a/b' }))
    expect(decryptConnectionSecret).toHaveBeenCalledWith('secret')
    expect(call).toHaveBeenCalledWith(
      {
        url: server.url,
        headerName: 'Authorization',
        headerValue: 'dec:secret',
      },
      'list_issues',
      { repo: 'a/b' },
    )
    expect(output.summary).toBe('list_issues executada em GitHub')
    expect(output.data).toEqual(
      expect.objectContaining({
        resultado: 'resultado',
        aviso: expect.stringContaining('Conteúdo de terceiros'),
      }),
    )
  })

  it('should call without credentials when none are stored', async () => {
    repo.findById.mockResolvedValue(ok({ ...server, encryptedAuthValue: null }))
    const tool = buildMcpTool(server, remote('list_issues'))
    expectOk(await tool.execute(CTX, {}))
    expect(call.mock.calls[0][0].headerValue).toBeNull()
  })

  it('should refuse when the tool left the allow-list or the server is off', async () => {
    const tool = buildMcpTool(server, remote('list_issues'))
    repo.findById.mockResolvedValue(ok({ ...server, enabled: false }))
    expectErr(await tool.execute(CTX, {}), 'STEEL_MCP_SERVER_INVALID')
    repo.findById.mockResolvedValue(ok({ ...server, allowedTools: [] }))
    expectErr(await tool.execute(CTX, {}), 'STEEL_MCP_SERVER_INVALID')
    repo.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(await tool.execute(CTX, {}), 'DATABASE_ERROR')
    expect(call).not.toHaveBeenCalled()
  })

  it('should fail on an undecryptable secret, a transport error and a remote error', async () => {
    const tool = buildMcpTool(server, remote('list_issues'))
    vi.mocked(decryptConnectionSecret).mockRejectedValueOnce(new Error('bad'))
    expectErr(await tool.execute(CTX, {}), 'STEEL_MCP_SERVER_INVALID')
    call.mockResolvedValue(
      err(appError('STEEL_MCP_SERVER_UNREACHABLE', 'offline')),
    )
    expectErr(await tool.execute(CTX, {}), 'STEEL_MCP_SERVER_UNREACHABLE')
    call.mockResolvedValue(ok({ text: 'quota', isError: true }))
    const failed = await tool.execute(CTX, {})
    expectErr(failed, 'STEEL_MCP_SERVER_UNREACHABLE')
    expect(failed.ok ? '' : failed.error.message).toContain('quota')
  })
})
