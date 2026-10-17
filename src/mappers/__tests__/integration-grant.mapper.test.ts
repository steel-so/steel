import { describe, expect, it } from 'vitest'
import {
  createFakeIntegrationGrantWithRelations,
  createFakeWorkspaceIntegrationGrantRow,
} from '@/src/__tests__/factories/integration-grant.factory'
import {
  toIntegrationGrantDTO,
  toMcpScopes,
  toWorkspaceIntegrationClientDTOs,
  toWorkspaceIntegrationGrantDTO,
} from '../integration-grant.mapper'

describe('toMcpScopes', () => {
  it('keeps the MCP scopes in canonical order', () => {
    expect(toMcpScopes(['offline_access', 'mcp:write', 'mcp:read'])).toEqual([
      'mcp:read',
      'mcp:write',
    ])
    expect(toMcpScopes(['openid'])).toEqual([])
  })
})

describe('toIntegrationGrantDTO', () => {
  it('maps a grant with its client and workspace', () => {
    const grant = createFakeIntegrationGrantWithRelations({
      scopes: ['mcp:read', 'offline_access'],
      modules: ['CRM', 'SERVICE_DESK'],
      createdAt: new Date('2026-10-17T10:00:00Z'),
    })
    expect(toIntegrationGrantDTO(grant)).toEqual({
      id: grant.id,
      client: {
        clientId: grant.clientId,
        name: 'Claude',
        icon: null,
        uri: null,
      },
      workspace: { id: grant.workspaceId, name: 'Acme', slug: 'acme' },
      scopes: ['mcp:read'],
      modules: ['CRM', 'SERVICE_DESK'],
      lastUsedAt: null,
      createdAt: '2026-10-17T10:00:00.000Z',
    })
  })

  it('serializes lastUsedAt', () => {
    const grant = createFakeIntegrationGrantWithRelations({
      lastUsedAt: new Date('2026-10-17T11:00:00Z'),
    })
    expect(toIntegrationGrantDTO(grant).lastUsedAt).toBe(
      '2026-10-17T11:00:00.000Z',
    )
  })
})

describe('toWorkspaceIntegrationGrantDTO', () => {
  it('maps the holder, the app and the grant usage', () => {
    const grant = createFakeWorkspaceIntegrationGrantRow({
      id: 'g1',
      scopes: ['mcp:write', 'mcp:read', 'offline_access'],
      modules: ['SERVICE_DESK'],
      lastUsedAt: new Date('2026-10-17T11:00:00Z'),
      createdAt: new Date('2026-10-01T10:00:00Z'),
      user: { image: 'https://cdn/ana.png' },
    })
    const usage = new Map([['g1', { last7Days: 3, last30Days: 9 }]])
    expect(toWorkspaceIntegrationGrantDTO(grant, usage)).toEqual({
      id: 'g1',
      user: {
        id: grant.userId,
        name: 'Ana',
        email: 'ana@example.com',
        image: 'https://cdn/ana.png',
      },
      client: {
        clientId: grant.clientId,
        name: 'Claude',
        icon: null,
        uri: null,
      },
      scopes: ['mcp:read', 'mcp:write'],
      modules: ['SERVICE_DESK'],
      lastUsedAt: '2026-10-17T11:00:00.000Z',
      createdAt: '2026-10-01T10:00:00.000Z',
      usage: { last7Days: 3, last30Days: 9 },
    })
  })

  it('reads zero usage and a null last use', () => {
    const dto = toWorkspaceIntegrationGrantDTO(
      createFakeWorkspaceIntegrationGrantRow(),
      new Map(),
    )
    expect(dto.usage).toEqual({ last7Days: 0, last30Days: 0 })
    expect(dto.lastUsedAt).toBeNull()
  })
})

describe('toWorkspaceIntegrationClientDTOs', () => {
  it('groups grants per app with members, write access, last use and usage', () => {
    const grants = [
      createFakeWorkspaceIntegrationGrantRow({
        clientId: 'claude',
        userId: 'u1',
        lastUsedAt: new Date('2026-10-10T00:00:00Z'),
      }),
      createFakeWorkspaceIntegrationGrantRow({
        clientId: 'cursor',
        userId: 'u1',
        clientName: null,
      }),
      createFakeWorkspaceIntegrationGrantRow({
        clientId: 'claude',
        userId: 'u2',
        scopes: ['mcp:read', 'mcp:write'],
        lastUsedAt: new Date('2026-10-12T00:00:00Z'),
      }),
      createFakeWorkspaceIntegrationGrantRow({
        clientId: 'claude',
        userId: 'u2',
        lastUsedAt: new Date('2026-10-11T00:00:00Z'),
      }),
    ]
    const usage = new Map([['claude', { last7Days: 4, last30Days: 20 }]])

    expect(toWorkspaceIntegrationClientDTOs(grants, usage)).toEqual([
      {
        client: { clientId: 'claude', name: 'Claude', icon: null, uri: null },
        members: 2,
        canWrite: true,
        lastUsedAt: '2026-10-12T00:00:00.000Z',
        usage: { last7Days: 4, last30Days: 20 },
      },
      {
        client: { clientId: 'cursor', name: null, icon: null, uri: null },
        members: 1,
        canWrite: false,
        lastUsedAt: null,
        usage: { last7Days: 0, last30Days: 0 },
      },
    ])
    expect(toWorkspaceIntegrationClientDTOs([], usage)).toEqual([])
  })
})
