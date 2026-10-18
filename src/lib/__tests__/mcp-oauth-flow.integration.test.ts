import { createHash, randomBytes } from 'node:crypto'
import { createId } from '@paralleldrive/cuid2'
import { hash } from 'argon2'
import { describe, expect, it } from 'vitest'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { auth } from '@/src/lib/auth'
import { resolveMcpGrant } from '@/src/lib/mcp/grant'
import { appOrigin, mcpResourceUrl } from '@/src/lib/mcp/oauth-config'
import { prisma } from '@/src/lib/prisma'
import { IntegrationGrantService } from '@/src/services/integration-grant.service'

/**
 * The whole OAuth provider flow against the real Better Auth handler and
 * database, without a running server: dynamic registration → authorize →
 * consent (our service) → code exchange with PKCE → token resolves to the
 * grant → refresh → revocation cuts both tokens.
 */

const ORIGIN = appOrigin()
const REDIRECT_URI = 'http://127.0.0.1:33418/callback'
const PASSWORD = 'Test@12345678'

function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (!headers.has('origin')) headers.set('origin', ORIGIN)
  return auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, { ...init, headers }),
  )
}

function form(body: Record<string, string>) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  }
}

async function signedInUser() {
  const email = `oauth-${createId()}@example.com`
  const user = await prisma.user.create({
    data: {
      name: 'OAuth User',
      email,
      username: `oauth-${createId()}`.toLowerCase(),
      emailVerified: true,
      acceptedTermsAt: new Date(),
      acceptedPrivacyAt: new Date(),
    },
  })
  await prisma.account.create({
    data: {
      accountId: user.id,
      providerId: 'credential',
      userId: user.id,
      password: await hash(PASSWORD),
    },
  })
  const res = await call('/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  expect(res.status).toBe(200)
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  return { user, cookie }
}

async function registerClient() {
  const res = await call('/oauth2/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Test MCP client',
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  })
  expect(res.status).toBeLessThan(300)
  const body = (await res.json()) as { client_id: string }
  return body.client_id
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

async function authorize(clientId: string, cookie: string, challenge: string) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'mcp:read mcp:write offline_access',
    state: 'state-123',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: mcpResourceUrl(),
  })
  const res = await call(`/oauth2/authorize?${query}`, {
    headers: { cookie },
  })
  const location = res.headers.get('location')
  expect(location, `status ${res.status}`).toBeTruthy()
  return new URL(location as string, ORIGIN)
}

function bearer(token: string) {
  return new Request(`${ORIGIN}/api/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
}

describe('MCP OAuth flow', () => {
  it('issues tokens bound to the consented grant and revokes them', async () => {
    const { user, cookie } = await signedInUser()
    const workspace = await seedWorkspace({ name: 'Acme' })
    await prisma.membership.create({
      data: { userId: user.id, workspaceId: workspace.id, role: 'MEMBER' },
    })
    await prisma.workspaceModuleAccess.createMany({
      data: (['CRM', 'SERVICE_DESK'] as const).map((module) => ({
        workspaceId: workspace.id,
        module,
        enabled: true,
        grantedById: user.id,
      })),
    })

    const clientId = await registerClient()
    const { verifier, challenge } = pkce()

    // 1. Authorize always lands on our consent page.
    const consentUrl = await authorize(clientId, cookie, challenge)
    expect(consentUrl.pathname).toBe('/oauth/consent')
    const oauthQuery = consentUrl.search.slice(1)

    const context = expectOk(
      await IntegrationGrantService.getConsentContext(user.id, oauthQuery),
    )
    expect(context.client.name).toBe('Test MCP client')
    expect(context.requestedScopes).toEqual(['mcp:read', 'mcp:write'])
    expect(context.workspaces.map((w) => w.id)).toEqual([workspace.id])

    // 2. Consent (read only, CRM only) → code on the client's redirect_uri.
    const consent = expectOk(
      await IntegrationGrantService.consent(
        user.id,
        {
          accept: true,
          oauthQuery,
          workspaceId: workspace.id,
          modules: ['CRM'],
          scopes: ['mcp:read'],
        },
        new Headers({ cookie, origin: ORIGIN }),
      ),
    )
    const callback = new URL(consent.redirectUrl)
    expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT_URI)
    expect(callback.searchParams.get('state')).toBe('state-123')
    const code = callback.searchParams.get('code')
    expect(code).toBeTruthy()

    // 3. Code exchange with PKCE.
    const tokenRes = await call(
      '/oauth2/token',
      form({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: verifier,
        resource: mcpResourceUrl(),
      }),
    )
    const tokens = (await tokenRes.json()) as {
      access_token: string
      refresh_token?: string
      scope: string
    }
    expect(tokenRes.status, JSON.stringify(tokens)).toBe(200)
    expect(tokens.access_token.startsWith('stl_at_')).toBe(true)
    expect(tokens.refresh_token?.startsWith('stl_rt_')).toBe(true)
    expect(tokens.scope.split(' ').sort()).toEqual(
      ['mcp:read', 'offline_access'].sort(),
    )

    // 4. The token resolves to the grant.
    const grant = expectOk(await resolveMcpGrant(bearer(tokens.access_token)))
    expect(grant).toMatchObject({
      userId: user.id,
      workspaceId: workspace.id,
      clientId,
      clientName: 'Test MCP client',
      scopes: ['mcp:read'],
      modules: ['CRM'],
    })
    const stored = await prisma.integrationGrant.findUniqueOrThrow({
      where: { id: grant.grantId },
    })
    expect(stored.lastUsedAt).not.toBeNull()

    // 5. Refresh keeps the grant.
    const refreshRes = await call(
      '/oauth2/token',
      form({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token as string,
        client_id: clientId,
        resource: mcpResourceUrl(),
      }),
    )
    const refreshed = (await refreshRes.json()) as {
      access_token: string
      refresh_token: string
    }
    expect(refreshRes.status, JSON.stringify(refreshed)).toBe(200)
    expect(
      expectOk(await resolveMcpGrant(bearer(refreshed.access_token))).grantId,
    ).toBe(grant.grantId)

    // 6. A new authorization asks for consent again (never auto-approved).
    const again = await authorize(clientId, cookie, pkce().challenge)
    expect(again.pathname).toBe('/oauth/consent')

    // 7. Revocation cuts the access token and the refresh token.
    expectOk(
      await IntegrationGrantService.revokeForUser(user.id, grant.grantId),
    )
    expectErr(
      await resolveMcpGrant(bearer(refreshed.access_token)),
      'UNAUTHORIZED',
    )
    const afterRevoke = await call(
      '/oauth2/token',
      form({
        grant_type: 'refresh_token',
        refresh_token: refreshed.refresh_token,
        client_id: clientId,
      }),
    )
    expect(afterRevoke.status).toBeGreaterThanOrEqual(400)
  })

  it('cuts the token when the user leaves the workspace', async () => {
    const { user, cookie } = await signedInUser()
    const workspace = await seedWorkspace()
    await prisma.membership.create({
      data: { userId: user.id, workspaceId: workspace.id, role: 'OWNER' },
    })
    await prisma.workspaceModuleAccess.create({
      data: {
        workspaceId: workspace.id,
        module: 'SERVICE_DESK',
        enabled: true,
        grantedById: user.id,
      },
    })
    const clientId = await registerClient()
    const { verifier, challenge } = pkce()
    const consentUrl = await authorize(clientId, cookie, challenge)
    const consent = expectOk(
      await IntegrationGrantService.consent(
        user.id,
        {
          accept: true,
          oauthQuery: consentUrl.search.slice(1),
          workspaceId: workspace.id,
          modules: ['SERVICE_DESK'],
          scopes: ['mcp:read', 'mcp:write'],
        },
        new Headers({ cookie, origin: ORIGIN }),
      ),
    )
    const code = new URL(consent.redirectUrl).searchParams.get('code')
    const tokenRes = await call(
      '/oauth2/token',
      form({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: verifier,
      }),
    )
    const { access_token } = (await tokenRes.json()) as {
      access_token: string
    }
    expect(
      expectOk(await resolveMcpGrant(bearer(access_token))).scopes,
    ).toEqual(['mcp:read', 'mcp:write'])

    await prisma.membership.deleteMany({ where: { userId: user.id } })
    expectErr(await resolveMcpGrant(bearer(access_token)), 'UNAUTHORIZED')
  })

  it('refuses a tampered query and leaves no grant behind', async () => {
    const { user, cookie } = await signedInUser()
    const workspace = await seedWorkspace()
    await prisma.membership.create({
      data: { userId: user.id, workspaceId: workspace.id, role: 'OWNER' },
    })
    await prisma.workspaceModuleAccess.create({
      data: {
        workspaceId: workspace.id,
        module: 'CRM',
        enabled: true,
        grantedById: user.id,
      },
    })
    const clientId = await registerClient()
    const consentUrl = await authorize(clientId, cookie, pkce().challenge)
    const tampered = new URLSearchParams(consentUrl.search)
    tampered.set('state', 'forged')

    expectErr(
      await IntegrationGrantService.consent(
        user.id,
        {
          accept: true,
          oauthQuery: tampered.toString(),
          workspaceId: workspace.id,
          modules: ['CRM'],
          scopes: ['mcp:read'],
        },
        new Headers({ cookie, origin: ORIGIN }),
      ),
      'OAUTH_REQUEST_INVALID',
    )
    expect(await prisma.integrationGrant.count()).toBe(0)

    // Refusing sends the client an access_denied.
    const denied = expectOk(
      await IntegrationGrantService.consent(
        user.id,
        { accept: false, oauthQuery: consentUrl.search.slice(1) },
        new Headers({ cookie, origin: ORIGIN }),
      ),
    )
    expect(new URL(denied.redirectUrl).searchParams.get('error')).toBe(
      'access_denied',
    )
  })

  it('rejects a missing bearer token', async () => {
    expectErr(
      await resolveMcpGrant(new Request(`${ORIGIN}/api/mcp`)),
      'UNAUTHORIZED',
    )
  })
})
