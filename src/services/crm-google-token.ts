import type { CrmGoogleBusinessConnection } from '@prisma/client'
import {
  crmGoogleLocationNotSelected,
  crmSocialConnectionNotFound,
  crmSocialScopeMissing,
  crmSocialTokenExpired,
} from '@/src/errors'
import {
  hasBusinessScope,
  refreshGoogleBusinessToken,
} from '@/src/lib/google-business/oauth'
import { err, ok, type Result } from '@/src/lib/result'
import {
  decryptToken,
  encryptToken,
  isTokenCryptoConfigured,
} from '@/src/lib/social/crypto'
import { CrmGoogleConnectionRepository } from '@/src/repositories/crm-google-presence.repository'

/** Margin before the expiry in which the access token is already renewed. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000

export type GoogleAccess = {
  accessToken: string
  connection: CrmGoogleBusinessConnection
}

/**
 * A usable access token for a stored connection: decrypts the current one or
 * renews it with the refresh token. A connection that cannot be renewed is
 * marked `EXPIRED` so the screens ask the user to reconnect.
 */
export async function freshAccessToken(
  connection: CrmGoogleBusinessConnection,
): Promise<Result<GoogleAccess>> {
  if (!isTokenCryptoConfigured()) return err(crmSocialConnectionNotFound())
  if (connection.status !== 'CONNECTED') return err(crmSocialTokenExpired())
  if (!hasBusinessScope(connection.scope)) return err(crmSocialScopeMissing())

  const expiresAt = connection.tokenExpiresAt
  const nearExpiry = expiresAt
    ? expiresAt.getTime() - REFRESH_MARGIN_MS <= Date.now()
    : false

  if (!nearExpiry) {
    try {
      return ok({
        accessToken: decryptToken(connection.accessToken),
        connection,
      })
    } catch {
      await CrmGoogleConnectionRepository.setStatus(connection.id, 'EXPIRED')
      return err(crmSocialTokenExpired())
    }
  }

  if (!connection.refreshToken) {
    await CrmGoogleConnectionRepository.setStatus(connection.id, 'EXPIRED')
    return err(crmSocialTokenExpired())
  }

  let refreshToken: string
  try {
    refreshToken = decryptToken(connection.refreshToken)
  } catch {
    await CrmGoogleConnectionRepository.setStatus(connection.id, 'EXPIRED')
    return err(crmSocialTokenExpired())
  }

  const refreshed = await refreshGoogleBusinessToken(refreshToken)
  if (!refreshed.ok) {
    // Google answers 400 invalid_grant when the user revoked the access.
    await CrmGoogleConnectionRepository.setStatus(connection.id, 'EXPIRED')
    return err(crmSocialTokenExpired())
  }

  const updated = await CrmGoogleConnectionRepository.updateTokens(
    connection.id,
    {
      accessToken: encryptToken(refreshed.value.accessToken),
      refreshToken: refreshed.value.refreshToken
        ? encryptToken(refreshed.value.refreshToken)
        : undefined,
      tokenExpiresAt: refreshed.value.expiresAt,
      scope: refreshed.value.scope,
    },
  )
  if (!updated.ok) return updated
  return ok({
    accessToken: refreshed.value.accessToken,
    connection: updated.value,
  })
}

/** The workspace's connection with a fresh token (no location required). */
export async function googleAccessFor(
  workspaceId: string,
): Promise<Result<GoogleAccess>> {
  const found = await CrmGoogleConnectionRepository.findByWorkspace(workspaceId)
  if (!found.ok) return found
  if (!found.value) return err(crmSocialConnectionNotFound())
  return freshAccessToken(found.value)
}

/** Same, but the connection must already have a chosen location. */
export async function googleLocationAccessFor(workspaceId: string): Promise<
  Result<
    GoogleAccess & {
      accountName: string
      locationName: string
      /** `accounts/{a}/locations/{l}` — what the v4 APIs expect. */
      fullLocationName: string
    }
  >
> {
  const access = await googleAccessFor(workspaceId)
  if (!access.ok) return access
  const { accountName, locationName } = access.value.connection
  if (!accountName || !locationName) return err(crmGoogleLocationNotSelected())
  return ok({
    ...access.value,
    accountName,
    locationName,
    fullLocationName: `${accountName}/${locationName}`,
  })
}
