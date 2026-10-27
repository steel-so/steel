import { createId } from '@paralleldrive/cuid2'
import type { IntegrationGrant, ModuleKind } from '@prisma/client'
import { hashOpaqueToken } from '@/src/lib/mcp/oauth-utils'
import { prisma } from '@/src/lib/prisma'
import type {
  IntegrationGrantWithRelations,
  WorkspaceIntegrationGrantRow,
} from '@/src/repositories/integration-grant.repository'
import type {
  OauthAccessTokenWithClient,
  OauthClientSummary,
} from '@/src/repositories/oauth-client.repository'

export function createFakeOauthClientSummary(
  overrides?: Partial<OauthClientSummary>,
): OauthClientSummary {
  return {
    clientId: `client-${createId()}`,
    name: 'Claude',
    icon: null,
    uri: null,
    disabled: false,
    ...overrides,
  }
}

export function createFakeIntegrationGrant(
  overrides?: Partial<IntegrationGrant>,
): IntegrationGrant {
  const now = new Date()
  return {
    id: createId(),
    userId: createId(),
    workspaceId: createId(),
    clientId: `client-${createId()}`,
    scopes: ['mcp:read'],
    modules: ['CRM'],
    redirectHost: 'claude.ai',
    lastUsedAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeIntegrationGrantWithRelations(
  overrides?: Partial<IntegrationGrant>,
): IntegrationGrantWithRelations {
  const grant = createFakeIntegrationGrant(overrides)
  return {
    ...grant,
    client: { clientId: grant.clientId, name: 'Claude', icon: null, uri: null },
    workspace: { id: grant.workspaceId, name: 'Acme', slug: 'acme' },
  }
}

export function createFakeOauthAccessToken(
  overrides?: Partial<OauthAccessTokenWithClient>,
): OauthAccessTokenWithClient {
  const now = new Date()
  const clientId = overrides?.clientId ?? `client-${createId()}`
  return {
    id: createId(),
    token: createId(),
    clientId,
    sessionId: null,
    userId: createId(),
    referenceId: createId(),
    authorizationCodeId: null,
    resources: [],
    requestedUserInfoClaims: [],
    refreshId: null,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    createdAt: now,
    revoked: null,
    confirmation: null,
    scopes: ['mcp:read', 'offline_access'],
    client: createFakeOauthClientSummary({ clientId }),
    ...overrides,
  }
}

export async function seedOauthClient(overrides?: {
  clientId?: string
  name?: string | null
  disabled?: boolean
}) {
  return prisma.oauthClient.create({
    data: {
      clientId: overrides?.clientId ?? `client-${createId()}`,
      name: overrides?.name === undefined ? 'Claude' : overrides.name,
      disabled: overrides?.disabled ?? false,
      redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
      scopes: ['mcp:read', 'mcp:write', 'offline_access'],
      tokenEndpointAuthMethod: 'none',
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
    },
  })
}

export async function seedIntegrationGrant(data: {
  userId: string
  workspaceId: string
  clientId: string
  scopes?: string[]
  modules?: ModuleKind[]
  revokedAt?: Date | null
  lastUsedAt?: Date | null
}) {
  return prisma.integrationGrant.create({
    data: {
      userId: data.userId,
      workspaceId: data.workspaceId,
      clientId: data.clientId,
      scopes: data.scopes ?? ['mcp:read'],
      modules: data.modules ?? ['CRM'],
      revokedAt: data.revokedAt ?? null,
      lastUsedAt: data.lastUsedAt ?? null,
    },
  })
}

/**
 * Stores an access token the way the provider does (hash of the value
 * without the prefix) and returns the raw value a client would hold.
 */
export async function seedOauthAccessToken(data: {
  clientId: string
  userId: string
  referenceId: string
  scopes?: string[]
  expiresAt?: Date
  refreshId?: string | null
  revoked?: Date | null
}) {
  const raw = createId()
  const row = await prisma.oauthAccessToken.create({
    data: {
      token: hashOpaqueToken(raw),
      clientId: data.clientId,
      userId: data.userId,
      referenceId: data.referenceId,
      refreshId: data.refreshId ?? null,
      scopes: data.scopes ?? ['mcp:read', 'offline_access'],
      expiresAt: data.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
      revoked: data.revoked ?? null,
    },
  })
  return { row, raw: `stl_at_${raw}` }
}

/** `seedOauthAccessToken` for a refresh token (`stl_rt_…`). */
export async function seedOauthRefreshToken(data: {
  clientId: string
  userId: string
  referenceId: string | null
  expiresAt?: Date | null
  revoked?: Date | null
}) {
  const raw = createId()
  const row = await prisma.oauthRefreshToken.create({
    data: {
      token: hashOpaqueToken(raw),
      clientId: data.clientId,
      userId: data.userId,
      referenceId: data.referenceId,
      scopes: ['mcp:read', 'offline_access'],
      expiresAt:
        data.expiresAt === undefined
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          : data.expiresAt,
      revoked: data.revoked ?? null,
    },
  })
  return { row, raw: `stl_rt_${raw}` }
}

export function createFakeWorkspaceIntegrationGrantRow(
  overrides?: Partial<IntegrationGrant> & {
    user?: Partial<WorkspaceIntegrationGrantRow['user']>
    clientName?: string | null
  },
): WorkspaceIntegrationGrantRow {
  const { user, clientName, ...rest } = overrides ?? {}
  const grant = createFakeIntegrationGrant(rest)
  return {
    ...grant,
    client: {
      clientId: grant.clientId,
      name: clientName === undefined ? 'Claude' : clientName,
      icon: null,
      uri: null,
    },
    user: {
      id: grant.userId,
      name: 'Ana',
      email: 'ana@example.com',
      image: null,
      ...user,
    },
  }
}
