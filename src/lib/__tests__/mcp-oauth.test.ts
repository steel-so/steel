import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  formatModuleList,
  MCP_CONSENT_NOTICE_VERSION,
  mcpConsentNotice,
} from '@/src/lib/mcp/consent-notice'
import {
  currentGrantReference,
  PENDING_GRANT_REFERENCE,
  runWithGrantReference,
} from '@/src/lib/mcp/consent-reference'
import {
  appOrigin,
  mcpResourceUrl,
  oauthIssuer,
  protectedResourceMetadata,
} from '@/src/lib/mcp/oauth-config'
import {
  hashOpaqueToken,
  isOAuthQueryExpired,
  parseBearerToken,
  parseOAuthQuery,
} from '@/src/lib/mcp/oauth-utils'

describe('hashOpaqueToken', () => {
  it('matches the provider hash: SHA-256, base64url, no padding', () => {
    const expected = createHash('sha256')
      .update('abc')
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(hashOpaqueToken('abc')).toBe(expected)
  })
})

describe('parseBearerToken', () => {
  it('reads the bearer token, case-insensitively', () => {
    expect(parseBearerToken('Bearer stl_at_x')).toBe('stl_at_x')
    expect(parseBearerToken('  bearer   stl_at_y  ')).toBe('stl_at_y')
  })

  it('rejects other schemes and empty values', () => {
    expect(parseBearerToken(null)).toBeNull()
    expect(parseBearerToken('')).toBeNull()
    expect(parseBearerToken('Basic abc')).toBeNull()
    expect(parseBearerToken('Bearer a b')).toBeNull()
  })
})

describe('parseOAuthQuery', () => {
  it('reads client, scopes and expiry from the signed query', () => {
    const parsed = parseOAuthQuery(
      '?client_id=c1&scope=mcp%3Aread+offline_access&exp=1800000000&sig=s',
    )
    expect(parsed).toEqual({
      clientId: 'c1',
      scopes: ['mcp:read', 'offline_access'],
      expiresAt: new Date(1_800_000_000_000),
    })
  })

  it('needs a client and a signature', () => {
    expect(parseOAuthQuery('client_id=c1')).toBeNull()
    expect(parseOAuthQuery('sig=s')).toBeNull()
  })

  it('tolerates missing scope and expiry', () => {
    expect(parseOAuthQuery('client_id=c1&sig=s')).toEqual({
      clientId: 'c1',
      scopes: [],
      expiresAt: null,
    })
  })

  it('knows when it expired', () => {
    const now = new Date(1_800_000_000_000)
    const query = parseOAuthQuery('client_id=c&sig=s&exp=1800000000')
    expect(query && isOAuthQueryExpired(query, now)).toBe(true)
    expect(
      isOAuthQueryExpired({ clientId: 'c', scopes: [], expiresAt: null }, now),
    ).toBe(false)
  })
})

describe('consent reference', () => {
  it('is the grant id inside the run and a never-matching value outside', async () => {
    expect(currentGrantReference()).toBe(PENDING_GRANT_REFERENCE)
    const inside = await runWithGrantReference('grant-1', async () => {
      await Promise.resolve()
      return currentGrantReference()
    })
    expect(inside).toBe('grant-1')
    expect(currentGrantReference()).toBe(PENDING_GRANT_REFERENCE)
  })
})

describe('oauth config', () => {
  it('derives issuer, resource and metadata from the app origin', () => {
    expect(oauthIssuer()).toBe(`${appOrigin()}/api/auth`)
    expect(mcpResourceUrl()).toBe(`${appOrigin()}/api/mcp`)
    expect(protectedResourceMetadata()).toMatchObject({
      resource: mcpResourceUrl(),
      authorization_servers: [oauthIssuer()],
      scopes_supported: ['mcp:read', 'mcp:write'],
      bearer_methods_supported: ['header'],
    })
    expect(appOrigin().endsWith('/')).toBe(false)
  })
})

describe('consent notice', () => {
  it('joins modules the pt-BR way', () => {
    expect(formatModuleList(['CRM'])).toBe('CRM')
    expect(formatModuleList(['SERVICE_DESK', 'CRM', 'COMMUNICATION'])).toBe(
      'ServiceDesk, CRM e Comunicação',
    )
  })

  it('interpolates client, workspace and modules into the fixed copy', () => {
    expect(
      mcpConsentNotice({
        clientName: 'Claude',
        workspaceName: 'Acme',
        modules: ['SERVICE_DESK', 'CRM'],
      }),
    ).toBe(
      'Ao permitir, o Claude poderá consultar os dados do workspace Acme nos módulos ServiceDesk e CRM, sempre com as suas permissões no Steel. As informações consultadas serão enviadas ao provedor desse aplicativo de IA e tratadas conforme a política de privacidade dele. Cada acesso fica registrado e você pode desconectar quando quiser em Ajustes › Segurança › Apps conectados.',
    )
    expect(MCP_CONSENT_NOTICE_VERSION).toBe('mcp-consent-v1')
  })
})
