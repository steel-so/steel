import type { ApiToken } from '@prisma/client'
import { API_TOKEN_PREFIX, toApiScopes } from '@/src/lib/api/token'
import type {
  ApiTokenWithUser,
  ApiTokenWithWorkspace,
} from '@/src/repositories/api-token.repository'
import type { ApiTokenDTO, WorkspaceApiTokenDTO } from '@/types/api-token'

function baseFields(token: ApiToken, now: Date) {
  return {
    id: token.id,
    name: token.name,
    prefix: `${API_TOKEN_PREFIX}${token.prefix}`,
    scopes: toApiScopes(token.scopes),
    modules: token.modules,
    createdVia: token.createdVia,
    deviceName: token.deviceName,
    expiresAt: token.expiresAt.toISOString(),
    expired: token.expiresAt.getTime() <= now.getTime(),
    lastUsedAt: token.lastUsedAt ? token.lastUsedAt.toISOString() : null,
    createdAt: token.createdAt.toISOString(),
  }
}

export function toApiTokenDTO(
  token: ApiTokenWithWorkspace,
  now: Date = new Date(),
): ApiTokenDTO {
  return {
    ...baseFields(token, now),
    workspace: {
      id: token.workspace.id,
      name: token.workspace.name,
      slug: token.workspace.slug,
    },
  }
}

export function toWorkspaceApiTokenDTO(
  token: ApiTokenWithUser,
  now: Date = new Date(),
): WorkspaceApiTokenDTO {
  return {
    ...baseFields(token, now),
    user: {
      id: token.user.id,
      name: token.user.name,
      email: token.user.email,
      image: token.user.image,
    },
  }
}
