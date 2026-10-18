import { createId } from '@paralleldrive/cuid2'
import type { ApiToken, ModuleKind } from '@prisma/client'
import { generateApiToken } from '@/src/lib/api/token'
import { prisma } from '@/src/lib/prisma'
import type {
  ApiTokenWithUser,
  ApiTokenWithWorkspace,
} from '@/src/repositories/api-token.repository'

const DAY_MS = 24 * 60 * 60 * 1000

export function createFakeApiToken(overrides?: Partial<ApiToken>): ApiToken {
  const now = new Date()
  return {
    id: createId(),
    userId: createId(),
    workspaceId: createId(),
    name: 'Deploy',
    tokenHash: createId(),
    prefix: 'Xk3v9QaB',
    scopes: ['api:read'],
    modules: ['CRM'],
    expiresAt: new Date(now.getTime() + 90 * DAY_MS),
    lastUsedAt: null,
    revokedAt: null,
    createdVia: 'SETTINGS',
    deviceName: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeApiTokenWithWorkspace(
  overrides?: Partial<ApiToken>,
): ApiTokenWithWorkspace {
  const token = createFakeApiToken(overrides)
  return {
    ...token,
    workspace: { id: token.workspaceId, name: 'Acme', slug: 'acme' },
  }
}

export function createFakeApiTokenWithUser(
  overrides?: Partial<ApiToken> & {
    user?: Partial<ApiTokenWithUser['user']>
  },
): ApiTokenWithUser {
  const { user, ...rest } = overrides ?? {}
  const token = createFakeApiToken(rest)
  return {
    ...token,
    user: {
      id: token.userId,
      name: 'Ana',
      email: 'ana@example.com',
      image: null,
      ...user,
    },
  }
}

/** Stores a token the way the service does and returns the raw value too. */
export async function seedApiToken(data: {
  userId: string
  workspaceId: string
  name?: string
  scopes?: string[]
  modules?: ModuleKind[]
  expiresAt?: Date
  revokedAt?: Date | null
  lastUsedAt?: Date | null
}) {
  const generated = generateApiToken()
  const row = await prisma.apiToken.create({
    data: {
      userId: data.userId,
      workspaceId: data.workspaceId,
      name: data.name ?? 'Deploy',
      tokenHash: generated.tokenHash,
      prefix: generated.prefix,
      scopes: data.scopes ?? ['api:read'],
      modules: data.modules ?? ['CRM'],
      expiresAt: data.expiresAt ?? new Date(Date.now() + 90 * DAY_MS),
      revokedAt: data.revokedAt ?? null,
      lastUsedAt: data.lastUsedAt ?? null,
    },
  })
  return { row, raw: generated.token }
}
