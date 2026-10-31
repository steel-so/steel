import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSteelMcpServer } from '@/src/__tests__/factories/nov-ai-governance.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden, notFound } from '@/src/errors'
import { appError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'
import { CreateSteelMcpServerSchema } from '@/src/schemas/steel-mcp-server.schema'

vi.mock('@/src/services/authz', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/services/authz')>()),
  assertPrivileged: vi.fn(),
}))
vi.mock('@/src/repositories/steel-mcp-server.repository')
vi.mock('@/src/lib/steel-agents/mcp-client')
vi.mock('@/src/lib/webhooks/url-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/webhooks/url-guard')>()),
  checkWebhookUrl: vi.fn(),
}))
vi.mock('@/lib/axiom/audit')
vi.mock('@/src/lib/crypto', () => ({
  encryptConnectionSecret: vi.fn(async (v: string) => `enc(${v})`),
  decryptConnectionSecret: vi.fn(async (v: string) => v.slice(4, -1)),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import { discoverMcpTools } from '@/src/lib/steel-agents/mcp-client'
import { checkWebhookUrl } from '@/src/lib/webhooks/url-guard'
import { SteelMcpServerRepository } from '@/src/repositories/steel-mcp-server.repository'
import { assertPrivileged } from '@/src/services/authz'
import { SteelMcpServerService } from '../steel-mcp-server.service'

const privileged = vi.mocked(assertPrivileged)
const repo = vi.mocked(SteelMcpServerRepository)
const discover = vi.mocked(discoverMcpTools)
const urlGuard = vi.mocked(checkWebhookUrl)

const ADMIN = { role: 'ADMIN' as const, isPrivileged: true, permissions: null }
const REMOTE = [
  {
    name: 'list_issues',
    description: 'Lista',
    inputSchema: { type: 'object' },
    readOnly: true,
  },
  {
    name: 'create_issue',
    description: 'Cria',
    inputSchema: { type: 'object' },
    readOnly: false,
  },
]

const createDto = (overrides: Record<string, unknown> = {}) =>
  CreateSteelMcpServerSchema.parse({
    name: 'GitHub',
    url: 'https://mcp.example.com/mcp',
    ...overrides,
  })

let stored = createFakeSteelMcpServer()

beforeEach(() => {
  stored = createFakeSteelMcpServer()
  privileged.mockResolvedValue(ok(ADMIN))
  urlGuard.mockImplementation(async (raw) => ({ ok: true, url: new URL(raw) }))
  repo.listByWorkspace.mockResolvedValue(ok([]))
  repo.findById.mockResolvedValue(ok(createFakeSteelMcpServer()))
  repo.create.mockImplementation(async (data) => {
    stored = createFakeSteelMcpServer({
      ...(data as unknown as object),
      toolsCache: null,
      discoveredAt: null,
    })
    return ok(stored)
  })
  repo.update.mockImplementation(async (id, data) => {
    stored = { ...stored, id, ...(data as unknown as object) }
    return ok(stored)
  })
  repo.delete.mockResolvedValue(ok(true))
  discover.mockResolvedValue(ok(REMOTE))
})

describe('SteelMcpServerService.create', () => {
  it('should encrypt the secret, discover the tools and audit without the secret', async () => {
    const dto = expectOk(
      await SteelMcpServerService.create(
        'u1',
        'ws1',
        createDto({ authValue: 'Bearer abc' }),
      ),
    )
    const data = repo.create.mock.calls[0][0]
    expect(data).toEqual(
      expect.objectContaining({
        workspaceId: 'ws1',
        slug: 'github',
        url: 'https://mcp.example.com/mcp',
        encryptedAuthValue: 'enc(Bearer abc)',
        allowedTools: [],
        createdById: 'u1',
      }),
    )
    expect(JSON.stringify(dto)).not.toContain('Bearer abc')
    expect(dto.hasAuth).toBe(true)
    expect(dto.tools.map((t) => t.name)).toEqual([
      'list_issues',
      'create_issue',
    ])
    expect(dto.tools.every((t) => !t.allowed)).toBe(true)
    const audit = vi.mocked(auditMutation).mock.calls[0][0]
    expect(JSON.stringify(audit)).not.toContain('Bearer abc')
    expect(audit.meta).toEqual(
      expect.objectContaining({ host: 'mcp.example.com', hasAuth: true }),
    )
  })

  it('should keep only allow-listed names the server really has', async () => {
    const dto = expectOk(
      await SteelMcpServerService.create(
        'u1',
        'ws1',
        createDto({ allowedTools: ['list_issues', 'drop_database'] }),
      ),
    )
    expect(repo.update).toHaveBeenLastCalledWith(expect.any(String), {
      allowedTools: ['list_issues'],
    })
    expect(dto.id).toBeTruthy()
  })

  it('should refuse a URL the SSRF guard rejects', async () => {
    urlGuard.mockResolvedValue({ ok: false, reason: 'private_host' })
    expectErr(
      await SteelMcpServerService.create(
        'u1',
        'ws1',
        createDto({ url: 'https://10.0.0.1/mcp' }),
      ),
      'STEEL_MCP_SERVER_INVALID',
    )
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('should save the server with the discovery error when it is unreachable', async () => {
    discover.mockResolvedValue(
      err(appError('STEEL_MCP_SERVER_UNREACHABLE', 'fora do ar')),
    )
    repo.update.mockImplementation(async (id, data) =>
      ok(
        createFakeSteelMcpServer({
          id,
          toolsCache: null,
          ...(data as unknown as object),
        }),
      ),
    )
    const dto = expectOk(
      await SteelMcpServerService.create('u1', 'ws1', createDto()),
    )
    expect(dto.lastError).toBe('fora do ar')
    expect(dto.tools).toEqual([])
  })

  it('should fall back to the unchanged row when the discovery write fails', async () => {
    repo.update.mockResolvedValue(err(databaseError('x')))
    const dto = expectOk(
      await SteelMcpServerService.create('u1', 'ws1', createDto()),
    )
    expect(dto.tools).toEqual([])
    discover.mockResolvedValue(
      err(appError('STEEL_MCP_SERVER_UNREACHABLE', 'fora do ar')),
    )
    expectOk(await SteelMcpServerService.create('u1', 'ws1', createDto()))
  })

  it('should pick a unique slug and enforce the per-workspace limit', async () => {
    repo.listByWorkspace.mockResolvedValue(
      ok([createFakeSteelMcpServer({ slug: 'github' })]),
    )
    expectOk(await SteelMcpServerService.create('u1', 'ws1', createDto()))
    expect(repo.create.mock.calls[0][0].slug).toBe('github2')

    repo.listByWorkspace.mockResolvedValue(
      ok(
        Array.from({ length: 10 }, (_, i) =>
          createFakeSteelMcpServer({ slug: `s${i}` }),
        ),
      ),
    )
    expectErr(
      await SteelMcpServerService.create('u1', 'ws1', createDto()),
      'STEEL_MCP_SERVER_INVALID',
    )
    repo.listByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelMcpServerService.create('u1', 'ws1', createDto()),
      'DATABASE_ERROR',
    )
  })

  it('should be admin only and propagate create errors', async () => {
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(
      await SteelMcpServerService.create('m', 'ws1', createDto()),
      'FORBIDDEN',
    )
    privileged.mockResolvedValue(ok(ADMIN))
    repo.create.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelMcpServerService.create('u1', 'ws1', createDto()),
      'DATABASE_ERROR',
    )
  })
})

describe('SteelMcpServerService.list / delete', () => {
  it('should list for admins only', async () => {
    repo.listByWorkspace.mockResolvedValue(ok([createFakeSteelMcpServer()]))
    expect(
      expectOk(await SteelMcpServerService.list('u1', 'ws1')),
    ).toHaveLength(1)
    repo.listByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(await SteelMcpServerService.list('u1', 'ws1'), 'DATABASE_ERROR')
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(await SteelMcpServerService.list('m', 'ws1'), 'FORBIDDEN')
  })

  it('should delete, audit and propagate errors', async () => {
    expectOk(await SteelMcpServerService.delete('u1', 'ws1', 's1'))
    expect(repo.delete).toHaveBeenCalledWith(expect.any(String))
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'steel_mcp_server', action: 'delete' }),
    )
    repo.delete.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelMcpServerService.delete('u1', 'ws1', 's1'),
      'DATABASE_ERROR',
    )
    repo.findById.mockResolvedValue(err(notFound('x')))
    expectErr(await SteelMcpServerService.delete('u1', 'ws1', 's1'))
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(await SteelMcpServerService.delete('m', 'ws1', 's1'), 'FORBIDDEN')
  })
})

describe('SteelMcpServerService.update', () => {
  it('should change fields, re-encrypt the secret and never audit it', async () => {
    const dto = expectOk(
      await SteelMcpServerService.update('u1', 'ws1', 's1', {
        name: 'GH',
        enabled: false,
        authHeaderName: 'X-Token',
        authValue: 'novo',
      }),
    )
    expect(repo.update).toHaveBeenCalledWith(
      's1'.length ? expect.any(String) : '',
      {
        name: 'GH',
        enabled: false,
        authHeaderName: 'X-Token',
        encryptedAuthValue: 'enc(novo)',
      },
    )
    expect(dto.hasAuth).toBe(true)
    const audit = vi.mocked(auditMutation).mock.calls[0][0]
    expect(JSON.stringify(audit)).not.toContain('novo')
    expect(audit.meta).toEqual(expect.objectContaining({ secretChanged: true }))
  })

  it('should clear the secret with null or empty', async () => {
    expectOk(
      await SteelMcpServerService.update('u1', 'ws1', 's1', {
        authValue: null,
      }),
    )
    expect(repo.update.mock.calls[0][1]).toEqual({ encryptedAuthValue: null })
  })

  it('should replace the allow-list only with names the server has', async () => {
    expectOk(
      await SteelMcpServerService.update('u1', 'ws1', 's1', {
        allowedTools: ['list_issues'],
      }),
    )
    expect(repo.update.mock.calls[0][1]).toEqual({
      allowedTools: ['list_issues'],
    })
    expectErr(
      await SteelMcpServerService.update('u1', 'ws1', 's1', {
        allowedTools: ['nope'],
      }),
      'STEEL_MCP_SERVER_INVALID',
    )
  })

  it('should drop the allow-list and cache when the URL changes', async () => {
    repo.findById.mockResolvedValue(
      ok(createFakeSteelMcpServer({ allowedTools: ['list_issues'] })),
    )
    expectOk(
      await SteelMcpServerService.update('u1', 'ws1', 's1', {
        url: 'https://other.example.com/mcp',
      }),
    )
    expect(repo.update.mock.calls[0][1]).toEqual({
      url: 'https://other.example.com/mcp',
      allowedTools: [],
      toolsCache: [],
      discoveredAt: null,
    })
  })

  it('should keep the allow-list when the URL is the same', async () => {
    expectOk(
      await SteelMcpServerService.update('u1', 'ws1', 's1', {
        url: 'https://mcp.example.com/mcp',
      }),
    )
    expect(repo.update.mock.calls[0][1]).toEqual({
      url: 'https://mcp.example.com/mcp',
    })
  })

  it('should refuse a private URL, a missing server, non-admins and db errors', async () => {
    urlGuard.mockResolvedValue({ ok: false, reason: 'not_https' })
    expectErr(
      await SteelMcpServerService.update('u1', 'ws1', 's1', {
        url: 'http://x',
      }),
      'STEEL_MCP_SERVER_INVALID',
    )
    urlGuard.mockImplementation(async (raw) => ({
      ok: true,
      url: new URL(raw),
    }))
    repo.findById.mockResolvedValue(err(notFound('x')))
    expectErr(
      await SteelMcpServerService.update('u1', 'ws1', 's1', { name: 'x' }),
    )
    repo.findById.mockResolvedValue(ok(createFakeSteelMcpServer()))
    repo.update.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelMcpServerService.update('u1', 'ws1', 's1', { name: 'x' }),
      'DATABASE_ERROR',
    )
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(
      await SteelMcpServerService.update('m', 'ws1', 's1', { name: 'x' }),
      'FORBIDDEN',
    )
  })
})

describe('SteelMcpServerService.refresh', () => {
  it('should rediscover the tools, prune the allow-list and audit', async () => {
    repo.findById.mockResolvedValue(
      ok(
        createFakeSteelMcpServer({
          allowedTools: ['list_issues', 'removed_tool'],
          encryptedAuthValue: 'enc(Bearer z)',
        }),
      ),
    )
    expectOk(await SteelMcpServerService.refresh('u1', 'ws1', 's1'))
    expect(decryptConnectionSecret).toHaveBeenCalledWith('enc(Bearer z)')
    expect(discover).toHaveBeenCalledWith(
      expect.objectContaining({ headerValue: 'Bearer z' }),
    )
    expect(repo.update.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        toolsCache: REMOTE,
        lastError: null,
        allowedTools: ['list_issues'],
      }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sync', outcome: 'success' }),
    )
  })

  it('should record an undecryptable secret as the server error', async () => {
    repo.findById.mockResolvedValue(
      ok(createFakeSteelMcpServer({ encryptedAuthValue: 'enc(x)' })),
    )
    vi.mocked(decryptConnectionSecret).mockRejectedValueOnce(new Error('bad'))
    expectOk(await SteelMcpServerService.refresh('u1', 'ws1', 's1'))
    expect(repo.update.mock.calls[0][1]).toEqual({
      lastError: 'Não foi possível ler as credenciais guardadas.',
    })
    expect(discover).not.toHaveBeenCalled()
  })

  it('should audit a failed discovery and refuse private or missing servers', async () => {
    discover.mockResolvedValue(
      err(appError('STEEL_MCP_SERVER_UNREACHABLE', 'fora')),
    )
    repo.update.mockImplementation(async (id, data) =>
      ok(createFakeSteelMcpServer({ id, ...(data as unknown as object) })),
    )
    expectOk(await SteelMcpServerService.refresh('u1', 'ws1', 's1'))
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sync', outcome: 'failure' }),
    )
    urlGuard.mockResolvedValue({ ok: false, reason: 'private_host' })
    expectErr(
      await SteelMcpServerService.refresh('u1', 'ws1', 's1'),
      'STEEL_MCP_SERVER_INVALID',
    )
    repo.findById.mockResolvedValue(err(notFound('x')))
    expectErr(await SteelMcpServerService.refresh('u1', 'ws1', 's1'))
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(
      await SteelMcpServerService.refresh('m', 'ws1', 's1'),
      'FORBIDDEN',
    )
  })
})
