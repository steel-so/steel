import type { OauthAccessToken, OauthClient } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Read side of the oauth-provider plugin tables. The plugin writes them
 * through the Better Auth adapter; Steel only reads them to render the
 * consent page and to resolve MCP tokens (ADR 0033).
 */

export type OauthClientSummary = Pick<
  OauthClient,
  'clientId' | 'name' | 'icon' | 'uri' | 'disabled'
>

export type OauthAccessTokenWithClient = OauthAccessToken & {
  client: OauthClientSummary
}

const CLIENT_SUMMARY = {
  clientId: true,
  name: true,
  icon: true,
  uri: true,
  disabled: true,
} as const

export const OauthClientRepository = {
  async findByClientId(
    clientId: string,
  ): Promise<Result<OauthClientSummary | null>> {
    try {
      const client = await prisma.oauthClient.findUnique({
        where: { clientId },
        select: CLIENT_SUMMARY,
      })
      return ok(client)
    } catch (error) {
      return err(dbError('Failed to find OAuth client', error))
    }
  },

  /** `tokenHash` is the stored value: SHA-256, base64url, no prefix. */
  async findAccessTokenByHash(
    tokenHash: string,
  ): Promise<Result<OauthAccessTokenWithClient | null>> {
    try {
      const token = await prisma.oauthAccessToken.findUnique({
        where: { token: tokenHash },
        include: { client: { select: CLIENT_SUMMARY } },
      })
      return ok(token)
    } catch (error) {
      return err(dbError('Failed to find OAuth access token', error))
    }
  },
}
