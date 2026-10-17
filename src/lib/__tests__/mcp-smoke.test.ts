import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  authorizeRedirect,
  buildAuthorizeUrl,
  callbackCode,
  consentQuery,
  cookieHeader,
  formatSmokeTable,
  MCP_SMOKE_REDIRECT_URI,
  MCP_SMOKE_USAGE,
  normalizeBaseUrl,
  parseSmokeArgs,
  pickSmokeTools,
  pkceChallenge,
  type SmokeStep,
  shortDetail,
  smokeExitCode,
} from '@/src/lib/mcp/smoke'

const BASE = 'https://steel.example.com'

describe('normalizeBaseUrl', () => {
  it('accepts the app origin and derives the MCP endpoint', () => {
    expect(normalizeBaseUrl(`${BASE}/`)).toEqual({
      ok: true,
      value: { origin: BASE, mcpUrl: `${BASE}/api/mcp` },
    })
  })

  it('accepts the MCP endpoint itself', () => {
    expect(normalizeBaseUrl(` ${BASE}/api/mcp/ `)).toEqual({
      ok: true,
      value: { origin: BASE, mcpUrl: `${BASE}/api/mcp` },
    })
  })

  it('keeps a base path in front of /api/mcp', () => {
    const result = normalizeBaseUrl('http://localhost:3014/steel/api/mcp')
    expect(result.ok && result.value.mcpUrl).toBe(
      'http://localhost:3014/steel/api/mcp',
    )
  })

  it('rejects invalid and non-http urls', () => {
    expect(normalizeBaseUrl('not a url')).toEqual({
      ok: false,
      error: 'Endereço inválido: not a url',
    })
    expect(normalizeBaseUrl('ftp://steel.example.com').ok).toBe(false)
  })
})

describe('parseSmokeArgs', () => {
  it('reads the token mode from the env', () => {
    const result = parseSmokeArgs([], {
      MCP_SMOKE_URL: BASE,
      MCP_SMOKE_TOKEN: ' stl_at_abc ',
    })
    expect(result).toEqual({
      ok: true,
      value: {
        mode: 'token',
        origin: BASE,
        mcpUrl: `${BASE}/api/mcp`,
        tools: [],
        token: 'stl_at_abc',
      },
    })
  })

  it('lets --url and --tools override the env', () => {
    const result = parseSmokeArgs(
      ['--url=http://localhost:3014', '--tools=sd_my_queue, ws_overview,'],
      { MCP_SMOKE_URL: BASE, MCP_SMOKE_TOKEN: 't' },
    )
    expect(result.ok && result.value.origin).toBe('http://localhost:3014')
    expect(result.ok && result.value.tools).toEqual([
      'sd_my_queue',
      'ws_overview',
    ])
  })

  it('requires a url and a token', () => {
    expect(parseSmokeArgs([], {})).toEqual({
      ok: false,
      error: 'Defina MCP_SMOKE_URL com o endereço do Steel.',
    })
    expect(parseSmokeArgs([], { MCP_SMOKE_URL: BASE }).ok).toBe(false)
    expect(parseSmokeArgs([], { MCP_SMOKE_URL: 'nope' }).ok).toBe(false)
  })

  it('rejects unknown flags and answers --help with the usage', () => {
    expect(parseSmokeArgs(['--verbose'], {})).toEqual({
      ok: false,
      error: 'Opção desconhecida: --verbose',
    })
    expect(parseSmokeArgs(['--help'], {})).toEqual({
      ok: false,
      error: MCP_SMOKE_USAGE,
    })
  })

  it('reads the oauth mode with defaults, falling back to the SMOKE_* names', () => {
    const result = parseSmokeArgs(['--oauth'], {
      SMOKE_BASE: BASE,
      SMOKE_EMAIL: 'smoke@example.com',
      SMOKE_PASSWORD: 'secret',
      MCP_SMOKE_WORKSPACE_ID: 'ws_1',
    })
    expect(result).toEqual({
      ok: true,
      value: {
        mode: 'oauth',
        origin: BASE,
        mcpUrl: `${BASE}/api/mcp`,
        tools: [],
        email: 'smoke@example.com',
        password: 'secret',
        workspaceId: 'ws_1',
        modules: ['SERVICE_DESK', 'CRM', 'COMMUNICATION'],
        scopes: ['mcp:read'],
        keep: false,
      },
    })
  })

  it('takes modules, scopes and --keep in the oauth mode', () => {
    const result = parseSmokeArgs(['--oauth', '--keep'], {
      MCP_SMOKE_URL: BASE,
      MCP_SMOKE_EMAIL: 'a@b.c',
      MCP_SMOKE_PASSWORD: 'p',
      MCP_SMOKE_WORKSPACE_ID: 'ws_1',
      MCP_SMOKE_MODULES: 'CRM,CRM,SERVICE_DESK',
      MCP_SMOKE_SCOPES: 'mcp:read,mcp:write',
    })
    expect(
      result.ok && result.value.mode === 'oauth' && result.value,
    ).toMatchObject({
      modules: ['CRM', 'SERVICE_DESK'],
      scopes: ['mcp:read', 'mcp:write'],
      keep: true,
    })
  })

  it('validates the oauth inputs', () => {
    const env = {
      MCP_SMOKE_URL: BASE,
      MCP_SMOKE_EMAIL: 'a@b.c',
      MCP_SMOKE_PASSWORD: 'p',
      MCP_SMOKE_WORKSPACE_ID: 'ws_1',
    }
    const error = (extra: Record<string, string | undefined>) => {
      const result = parseSmokeArgs(['--oauth'], { ...env, ...extra })
      return result.ok ? null : result.error
    }
    expect(error({ MCP_SMOKE_PASSWORD: undefined })).toMatch(/PASSWORD/)
    expect(error({ MCP_SMOKE_WORKSPACE_ID: ' ' })).toMatch(/WORKSPACE_ID/)
    expect(error({ MCP_SMOKE_MODULES: 'CRM,WIKI' })).toBe(
      'Módulo desconhecido: WIKI',
    )
    expect(error({ MCP_SMOKE_SCOPES: 'mcp:admin' })).toBe(
      'Escopo desconhecido: mcp:admin',
    )
    expect(error({ MCP_SMOKE_SCOPES: 'mcp:write' })).toBe(
      'O escopo mcp:read é obrigatório.',
    )
  })
})

describe('OAuth helpers', () => {
  it('derives the S256 challenge of a verifier', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    // RFC 7636, appendix B.
    expect(pkceChallenge(verifier)).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
    expect(pkceChallenge('x')).toBe(
      createHash('sha256').update('x').digest('base64url'),
    )
  })

  it('builds the authorize url with PKCE, resource and offline_access', () => {
    const url = new URL(
      buildAuthorizeUrl({
        authorizationEndpoint: `${BASE}/api/auth/oauth2/authorize`,
        clientId: 'client_1',
        scopes: ['mcp:read'],
        state: 'st',
        codeChallenge: 'ch',
        resource: `${BASE}/api/mcp`,
      }),
    )
    expect(url.pathname).toBe('/api/auth/oauth2/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'client_1',
      redirect_uri: MCP_SMOKE_REDIRECT_URI,
      scope: 'mcp:read offline_access',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      resource: `${BASE}/api/mcp`,
    })
  })

  it('reads the authorize redirect from the header or the json body', () => {
    expect(authorizeRedirect('/oauth/consent?a=1', null, BASE)).toBe(
      `${BASE}/oauth/consent?a=1`,
    )
    expect(
      authorizeRedirect(
        null,
        { redirect: true, url: '/oauth/consent?b=2' },
        BASE,
      ),
    ).toBe(`${BASE}/oauth/consent?b=2`)
    expect(authorizeRedirect(null, { url: 42 }, BASE)).toBeNull()
    expect(authorizeRedirect(null, null, BASE)).toBeNull()
    expect(authorizeRedirect(null, 'text', BASE)).toBeNull()
  })

  it('extracts the signed consent query', () => {
    expect(consentQuery(`${BASE}/oauth/consent?client_id=c&sig=s`)).toEqual({
      ok: true,
      value: 'client_id=c&sig=s',
    })
    expect(consentQuery(`${BASE}/sign-in?x=1`).ok).toBe(false)
    expect(consentQuery(`${BASE}/oauth/consent`).ok).toBe(false)
  })

  it('reads the code from the callback and checks the state', () => {
    const callback = `${MCP_SMOKE_REDIRECT_URI}?code=abc&state=st`
    expect(callbackCode(callback, 'st')).toEqual({ ok: true, value: 'abc' })
    expect(callbackCode(callback, 'other')).toEqual({
      ok: false,
      error: 'O state do retorno não confere.',
    })
    expect(callbackCode(`${MCP_SMOKE_REDIRECT_URI}?state=st`, 'st').ok).toBe(
      false,
    )
    expect(
      callbackCode(
        `${MCP_SMOKE_REDIRECT_URI}?error=access_denied&error_description=no`,
        'st',
      ),
    ).toEqual({ ok: false, error: 'O provedor recusou: access_denied (no)' })
    expect(
      callbackCode(`${MCP_SMOKE_REDIRECT_URI}?error=server_error`, 'st'),
    ).toEqual({ ok: false, error: 'O provedor recusou: server_error' })
  })

  it('folds Set-Cookie headers into one Cookie header', () => {
    expect(
      cookieHeader([
        'better-auth.session_token=abc.def; Path=/; HttpOnly; Secure',
        'better-auth.session_data=x=y; Path=/',
        'garbage',
        '=novalue',
        'better-auth.session_token=new; Path=/',
      ]),
    ).toBe('better-auth.session_token=new; better-auth.session_data=x=y')
    expect(cookieHeader([])).toBe('')
  })
})

describe('pickSmokeTools', () => {
  const listed = [
    { name: 'crm_list_pipelines', inputSchema: {} },
    { name: 'ws_overview' },
    { name: 'sd_ticket_counts', inputSchema: { required: ['period'] } },
    { name: 'zap_dashboard', inputSchema: { required: [] } },
    { name: 'sd_my_queue' },
  ]

  it('takes the preferred tools the server lists, without required args', () => {
    expect(pickSmokeTools(listed, [])).toEqual([
      'ws_overview',
      'crm_list_pipelines',
      'zap_dashboard',
    ])
    expect(pickSmokeTools(listed, [], 1)).toEqual(['ws_overview'])
  })

  it('returns explicit names as given', () => {
    expect(pickSmokeTools(listed, ['sd_get_ticket'])).toEqual(['sd_get_ticket'])
  })

  it('returns nothing when no preferred tool is listed', () => {
    expect(pickSmokeTools([{ name: 'other' }], [])).toEqual([])
  })
})

describe('report', () => {
  const steps: SmokeStep[] = [
    { name: 'initialize', ok: true, detail: 'steel 1.0.0', durationMs: 12.4 },
    { name: 'tools/list', ok: false, detail: 'HTTP 401', durationMs: 3 },
  ]

  it('formats an aligned pass/fail table with a total', () => {
    expect(formatSmokeTable(steps)).toBe(
      [
        '      Etapa       Tempo  Detalhe',
        'PASS  initialize  12 ms  steel 1.0.0',
        'FAIL  tools/list  3 ms   HTTP 401',
        '',
        '2 etapas, 1 falharam.',
      ].join('\n'),
    )
    expect(formatSmokeTable([steps[0] as SmokeStep])).toMatch(
      /1 etapas, todas passaram\.$/,
    )
  })

  it('exits 0 only when every step passed', () => {
    expect(smokeExitCode(steps)).toBe(1)
    expect(smokeExitCode([steps[0] as SmokeStep])).toBe(0)
    expect(smokeExitCode([])).toBe(1)
  })

  it('shortens details to one line', () => {
    expect(shortDetail('  a\n  b  ')).toBe('a b')
    expect(shortDetail('abcdef', 4)).toBe('abc…')
  })
})
