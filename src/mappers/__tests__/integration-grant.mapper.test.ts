import { describe, expect, it } from 'vitest'
import { createFakeIntegrationGrantWithRelations } from '@/src/__tests__/factories/integration-grant.factory'
import { toIntegrationGrantDTO, toMcpScopes } from '../integration-grant.mapper'

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
