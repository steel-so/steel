import type { ApiScope } from '@/src/lib/api/session'

export type ApiModuleDTO = 'SERVICE_DESK' | 'CRM' | 'COMMUNICATION'
export type ApiTokenCreatedViaDTO = 'SETTINGS' | 'DEVICE'

/** One row of "Tokens de API" (the holder's view); never the value. */
export interface ApiTokenDTO {
  id: string
  name: string
  /** `stl_pat_abcd1234` — the first characters, for recognition. */
  prefix: string
  workspace: { id: string; name: string; slug: string }
  scopes: ApiScope[]
  modules: ApiModuleDTO[]
  createdVia: ApiTokenCreatedViaDTO
  deviceName: string | null
  expiresAt: string
  /** Past `expiresAt`: kept in the list until revoked, but unusable. */
  expired: boolean
  lastUsedAt: string | null
  createdAt: string
}

/** Answer of the creation: the only time the value comes back. */
export interface ApiTokenCreatedDTO extends ApiTokenDTO {
  token: string
}

/** One row of the workspace list (OWNER/ADMIN): whose token it is. */
export interface WorkspaceApiTokenDTO extends Omit<ApiTokenDTO, 'workspace'> {
  user: { id: string; name: string; email: string; image: string | null }
}

/** `POST /api/v1/auth/device`. */
export interface DeviceAuthorizationDTO {
  deviceCode: string
  /** `ABCD-EFGH`, what the user confirms on `/device`. */
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  /** Seconds between polls. */
  interval: number
  /** Seconds until the codes expire. */
  expiresIn: number
}

/** `200` of `POST /api/v1/auth/device/token`. */
export interface DeviceTokenDTO {
  token: string
  tokenId: string
  expiresAt: string
  workspace: { id: string; slug: string; name: string }
  scopes: ApiScope[]
  modules: ApiModuleDTO[]
}

/** A workspace a token may be created for. */
export interface ApiTokenWorkspaceOptionDTO {
  id: string
  name: string
  slug: string
  /** Enabled modules the token may cover in this workspace. */
  modules: ApiModuleDTO[]
}

/** What `/device` renders for a code the user typed or followed. */
export interface DeviceAuthorizationContextDTO {
  userCode: string
  deviceName: string | null
  expiresAt: string
  workspaces: ApiTokenWorkspaceOptionDTO[]
}

/** `POST /api/device/authorize`. */
export interface DeviceAuthorizeResultDTO {
  status: 'approved' | 'denied'
}
