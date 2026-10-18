import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  authenticatedOwner,
  defaultHeaders,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

/**
 * OAuth provider for MCP clients, end to end over HTTP (ADR 0033):
 * discovery, dynamic registration, authorize → consent page, consent API,
 * PKCE code exchange, refresh, and revocation from "Apps conectados".
 */

const REDIRECT_URI = 'http://127.0.0.1:33418/callback'

function clientIp(): string {
  const octet = () => Math.floor(Math.random() * 200) + 10
  return `${octet()}.${octet()}.${octet()}.${octet()}`
}

async function register(name = 'E2E MCP client') {
  const res = await fetch(`${BASE_URL}/api/auth/oauth2/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': clientIp(),
    },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  })
  expect(res.status).toBeLessThan(300)
  return ((await res.json()) as { client_id: string }).client_id
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
    state: 'e2e-state',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: `${BASE_URL}/api/mcp`,
  })
  const res = await fetch(`${BASE_URL}/api/auth/oauth2/authorize?${query}`, {
    headers: { Cookie: cookie, 'x-forwarded-for': clientIp() },
    redirect: 'manual',
  })
  // A browser navigation gets a 302; Node's fetch sends `sec-fetch-mode:
  // cors`, so the provider answers `{ redirect: true, url }` instead.
  const location =
    res.headers.get('location') ??
    ((await res.json().catch(() => null)) as { url?: string } | null)?.url
  expect(location, `status ${res.status}`).toBeTruthy()
  return new URL(location as string, BASE_URL)
}

async function token(body: Record<string, string>) {
  return fetch(`${BASE_URL}/api/auth/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-forwarded-for': clientIp(),
    },
    body: new URLSearchParams(body).toString(),
  })
}

describe('OAuth discovery', () => {
  it('serves the authorization server metadata at both well-known paths', async () => {
    for (const path of [
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-authorization-server/api/auth',
    ]) {
      const res = await fetch(`${BASE_URL}${path}`)
      expect(res.status).toBe(200)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
      const body = await res.json()
      expect(body.issuer).toMatch(/\/api\/auth$/)
      expect(body.registration_endpoint).toMatch(/\/oauth2\/register$/)
      expect(body.code_challenge_methods_supported).toEqual(['S256'])
      expect(body.scopes_supported).toEqual(
        expect.arrayContaining(['mcp:read', 'mcp:write']),
      )
      expect(body.token_endpoint_auth_methods_supported).toContain('none')
    }
  })

  it('serves the protected resource metadata of /api/mcp', async () => {
    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/api/mcp',
    ]) {
      const res = await fetch(`${BASE_URL}${path}`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.resource).toMatch(/\/api\/mcp$/)
      expect(body.authorization_servers[0]).toMatch(/\/api\/auth$/)
      expect(body.scopes_supported).toEqual(['mcp:read', 'mcp:write'])
    }
  })
})

describe('OAuth authorization with consent', () => {
  it('goes from registration to a token bound to the grant, then revokes it', async () => {
    const { user, workspace } = await authenticatedOwner()
    const clientId = await register()
    const { verifier, challenge } = pkce()

    const consentUrl = await authorize(clientId, user.cookie, challenge)
    expect(consentUrl.pathname).toBe('/oauth/consent')

    // The consent page renders for the signed-in user.
    const page = await fetch(consentUrl, {
      headers: { Cookie: user.cookie },
      redirect: 'manual',
    })
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('E2E MCP client')

    const consent = await postJson(
      '/api/oauth/consent',
      {
        accept: true,
        oauthQuery: consentUrl.search.slice(1),
        workspaceId: workspace.id,
        modules: ['CRM'],
        scopes: ['mcp:read'],
      },
      user.cookie,
    )
    expect(consent.status).toBe(200)
    const { data } = await consent.json()
    const callback = new URL(data.redirectUrl)
    expect(callback.searchParams.get('state')).toBe('e2e-state')
    const code = callback.searchParams.get('code') as string

    const exchanged = await token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
      resource: `${BASE_URL}/api/mcp`,
    })
    expect(exchanged.status).toBe(200)
    const tokens = await exchanged.json()
    expect(tokens.access_token).toMatch(/^stl_at_/)
    expect(tokens.refresh_token).toMatch(/^stl_rt_/)

    // A code works once.
    const replay = await token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    })
    expect(replay.status).toBeGreaterThanOrEqual(400)

    // "Apps conectados" lists it.
    const list = await fetch(`${BASE_URL}/api/users/me/integration-grants`, {
      headers: { ...defaultHeaders, Cookie: user.cookie },
    })
    expect(list.status).toBe(200)
    const grants = (await list.json()).data
    expect(grants).toHaveLength(1)
    expect(grants[0]).toMatchObject({
      client: { clientId, name: 'E2E MCP client' },
      workspace: { id: workspace.id },
      scopes: ['mcp:read'],
      modules: ['CRM'],
    })

    const revoke = await fetch(
      `${BASE_URL}/api/users/me/integration-grants/${grants[0].id}`,
      { method: 'DELETE', headers: { ...defaultHeaders, Cookie: user.cookie } },
    )
    expect(revoke.status).toBe(200)

    expect(
      await prisma.oauthAccessToken.count({
        where: { referenceId: grants[0].id },
      }),
    ).toBe(0)
    const refresh = await token({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    })
    expect(refresh.status).toBeGreaterThanOrEqual(400)

    const again = await fetch(
      `${BASE_URL}/api/users/me/integration-grants/${grants[0].id}`,
      { method: 'DELETE', headers: { ...defaultHeaders, Cookie: user.cookie } },
    )
    expect(again.status).toBe(404)
  })

  it('refuses a workspace the user is not a member of', async () => {
    const { user } = await authenticatedOwner()
    const { workspace: foreign } = await authenticatedOwner()
    const clientId = await register()
    const consentUrl = await authorize(clientId, user.cookie, pkce().challenge)

    const res = await postJson(
      '/api/oauth/consent',
      {
        accept: true,
        oauthQuery: consentUrl.search.slice(1),
        workspaceId: foreign.id,
        modules: ['CRM'],
        scopes: ['mcp:read'],
      },
      user.cookie,
    )
    expect(res.status).toBe(403)
    expect(
      await prisma.integrationGrant.count({ where: { userId: user.id } }),
    ).toBe(0)
  })

  it('sends access_denied back to the client on refusal', async () => {
    const { user } = await authenticatedOwner()
    const clientId = await register()
    const consentUrl = await authorize(clientId, user.cookie, pkce().challenge)

    const res = await postJson(
      '/api/oauth/consent',
      { accept: false, oauthQuery: consentUrl.search.slice(1) },
      user.cookie,
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(new URL(data.redirectUrl).searchParams.get('error')).toBe(
      'access_denied',
    )
  })

  it('rejects a tampered query and invalid bodies', async () => {
    const { user, workspace } = await authenticatedOwner()
    const clientId = await register()
    const consentUrl = await authorize(clientId, user.cookie, pkce().challenge)
    const tampered = new URLSearchParams(consentUrl.search)
    tampered.set('redirect_uri', 'https://evil.example/cb')

    const forged = await postJson(
      '/api/oauth/consent',
      {
        accept: true,
        oauthQuery: tampered.toString(),
        workspaceId: workspace.id,
        modules: ['CRM'],
        scopes: ['mcp:read'],
      },
      user.cookie,
    )
    expect(forged.status).toBe(400)
    expect((await forged.json()).error.code).toBe('OAUTH_REQUEST_INVALID')

    const invalid = await postJson(
      '/api/oauth/consent',
      { accept: true, oauthQuery: 'x', workspaceId: workspace.id, modules: [] },
      user.cookie,
    )
    expect(invalid.status).toBe(422)
  })

  it('requires a session', async () => {
    const res = await postJson('/api/oauth/consent', {
      accept: false,
      oauthQuery: 'x',
    })
    expect(res.status).toBe(401)
  })
})
