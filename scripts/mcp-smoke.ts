/**
 * Smoke test of the Steel MCP server against a running environment
 * (`pnpm mcp:smoke`). It speaks MCP with the official SDK client, the way
 * Claude, ChatGPT or Cursor do, and prints a pass/fail table:
 *
 *   401 without token → initialize → tools/list → 2–3 read tools →
 *   resources/list → prompts/list
 *
 * Token mode (default) uses `MCP_SMOKE_TOKEN`. `--oauth` gets a token
 * headlessly first — dynamic client registration, email/password sign-in,
 * authorize with PKCE, the consent API and the code exchange — and revokes
 * the grant at the end (unless `--keep`). Run `pnpm mcp:smoke --help`.
 *
 * Reads `process.env` directly on purpose: these are operator inputs of a
 * CLI, not app configuration, so they stay out of the app env schema.
 */
import { randomBytes } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  authorizeRedirect,
  buildAuthorizeUrl,
  callbackCode,
  consentQuery,
  cookieHeader,
  formatSmokeTable,
  MCP_SMOKE_REDIRECT_URI,
  type McpSmokeConfig,
  type OAuthSmokeConfig,
  type ParseResult,
  parseSmokeArgs,
  pickSmokeTools,
  pkceChallenge,
  type SmokeStep,
  shortDetail,
  smokeExitCode,
} from '../src/lib/mcp/smoke'

class StepError extends Error {}

const steps: SmokeStep[] = []

/** Runs one step, records it and rethrows on failure (the run stops). */
async function step<T>(
  name: string,
  run: () => Promise<{ value: T; detail: string }>,
): Promise<T> {
  const started = performance.now()
  try {
    const { value, detail } = await run()
    steps.push({
      name,
      ok: true,
      detail,
      durationMs: performance.now() - started,
    })
    return value
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    steps.push({
      name,
      ok: false,
      detail: shortDetail(message),
      durationMs: performance.now() - started,
    })
    throw new StepError(message)
  }
}

/** Like `step`, but a failure is recorded without stopping the run. */
async function softStep(
  name: string,
  run: () => Promise<{ detail: string }>,
): Promise<void> {
  try {
    await step(name, async () => ({ value: null, ...(await run()) }))
  } catch (error) {
    if (!(error instanceof StepError)) throw error
  }
}

function unwrap<T>(result: ParseResult<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}

function expectStatus(response: Response, body: unknown, ok = 200): void {
  if (response.status !== ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`)
  }
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  const body = await readJson(response)
  expectStatus(response, body)
  return body as Record<string, unknown>
}

function stringField(body: Record<string, unknown>, field: string): string {
  const value = body[field]
  if (typeof value !== 'string' || !value) {
    throw new Error(`Resposta sem ${field}`)
  }
  return value
}

/** Missing token → 401 + `WWW-Authenticate` pointing at the metadata. */
async function checkChallenge(config: McpSmokeConfig): Promise<void> {
  await softStep('401 sem token', async () => {
    const response = await fetch(config.mcpUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    const challenge = response.headers.get('www-authenticate') ?? ''
    if (response.status !== 401) throw new Error(`HTTP ${response.status}`)
    if (!challenge.includes('resource_metadata=')) {
      throw new Error(`WWW-Authenticate sem resource_metadata: ${challenge}`)
    }
    return { detail: 'WWW-Authenticate com resource_metadata' }
  })
}

interface OAuthSession {
  accessToken: string
  clientId: string
  cookie: string
}

/** Registration → sign-in → authorize (PKCE) → consent API → token. */
async function oauthToken(config: OAuthSmokeConfig): Promise<OAuthSession> {
  const origin = config.origin
  const browser = { Origin: origin, accept: 'application/json' }

  const server = await step('metadados OAuth', async () => {
    const resource = await getJson(
      `${origin}/.well-known/oauth-protected-resource`,
    )
    const servers = resource.authorization_servers
    const issuer = Array.isArray(servers) ? servers[0] : null
    if (typeof issuer !== 'string') {
      throw new Error('Metadados do recurso sem authorization_servers')
    }
    const issuerUrl = new URL(issuer)
    const metadata = await getJson(
      `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerUrl.pathname.replace(/\/$/, '')}`,
    )
    return {
      value: {
        resource: stringField(resource, 'resource'),
        authorize: stringField(metadata, 'authorization_endpoint'),
        token: stringField(metadata, 'token_endpoint'),
        register: stringField(metadata, 'registration_endpoint'),
      },
      detail: `emissor ${issuer}`,
    }
  })

  const clientId = await step('registro dinâmico', async () => {
    const response = await fetch(server.register, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Steel MCP smoke',
        redirect_uris: [MCP_SMOKE_REDIRECT_URI],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    })
    const body = (await readJson(response)) as Record<string, unknown> | null
    if (!response.ok || !body) {
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`)
    }
    const id = stringField(body, 'client_id')
    return { value: id, detail: `client_id ${id}` }
  })

  const cookie = await step('login', async () => {
    const response = await fetch(`${origin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { ...browser, 'content-type': 'application/json' },
      body: JSON.stringify({ email: config.email, password: config.password }),
    })
    const body = (await readJson(response)) as Record<string, unknown> | null
    expectStatus(response, body)
    if (body?.twoFactorRedirect) {
      throw new Error('A conta pede segundo fator; use uma conta sem 2FA')
    }
    const jar = cookieHeader(response.headers.getSetCookie())
    if (!jar.includes('session_token=')) {
      throw new Error('O login não devolveu o cookie de sessão')
    }
    return { value: jar, detail: 'sessão aberta' }
  })

  const verifier = randomBytes(32).toString('base64url')
  const state = randomBytes(12).toString('base64url')

  const oauthQuery = await step('authorize', async () => {
    const response = await fetch(
      buildAuthorizeUrl({
        authorizationEndpoint: server.authorize,
        clientId,
        scopes: config.scopes,
        state,
        codeChallenge: pkceChallenge(verifier),
        resource: server.resource,
      }),
      { headers: { ...browser, Cookie: cookie }, redirect: 'manual' },
    )
    const target = authorizeRedirect(
      response.headers.get('location'),
      await readJson(response),
      origin,
    )
    if (!target) throw new Error(`HTTP ${response.status} sem redirecionamento`)
    return {
      value: unwrap(consentQuery(target)),
      detail: 'chegou ao consentimento',
    }
  })

  const code = await step('consentimento', async () => {
    const response = await fetch(`${origin}/api/oauth/consent`, {
      method: 'POST',
      headers: {
        ...browser,
        'content-type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        accept: true,
        oauthQuery,
        workspaceId: config.workspaceId,
        modules: config.modules,
        scopes: config.scopes,
      }),
    })
    const body = (await readJson(response)) as {
      data?: { redirectUrl?: string }
    } | null
    expectStatus(response, body)
    const redirectUrl = body?.data?.redirectUrl
    if (!redirectUrl) throw new Error('Consentimento sem redirectUrl')
    return {
      value: unwrap(callbackCode(redirectUrl, state)),
      detail: `${config.modules.join(', ')} · ${config.scopes.join(' ')}`,
    }
  })

  const accessToken = await step('troca do código', async () => {
    const response = await fetch(server.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: MCP_SMOKE_REDIRECT_URI,
        client_id: clientId,
        code_verifier: verifier,
        resource: server.resource,
      }).toString(),
    })
    const body = (await readJson(response)) as Record<string, unknown> | null
    if (!response.ok || !body) {
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`)
    }
    const token = stringField(body, 'access_token')
    const refresh = typeof body.refresh_token === 'string' ? ' + refresh' : ''
    return { value: token, detail: `access token${refresh}` }
  })

  return { accessToken, clientId, cookie }
}

/** The MCP session itself, with the SDK client. */
async function runMcp(config: McpSmokeConfig, token: string): Promise<void> {
  const client = new Client({ name: 'steel-mcp-smoke', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(config.mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })

  try {
    await step('initialize', async () => {
      await client.connect(transport)
      const info = client.getServerVersion()
      return {
        value: null,
        detail: `${info?.name ?? '?'} ${info?.version ?? ''}`.trim(),
      }
    })

    const listed = await step('tools/list', async () => {
      const { tools } = await client.listTools()
      const writes = tools.filter((t) => !t.annotations?.readOnlyHint).length
      if (tools.length === 0) {
        throw new Error(
          'Nenhuma ferramenta (Steel IA desligada ou sem módulos?)',
        )
      }
      return {
        value: tools,
        detail: `${tools.length} ferramentas, ${writes} de escrita`,
      }
    })

    const names = pickSmokeTools(listed, config.tools)
    if (names.length === 0) {
      steps.push({
        name: 'tools/call',
        ok: false,
        detail: 'Nenhuma das ferramentas sugeridas foi listada; use --tools=',
        durationMs: 0,
      })
    }
    for (const name of names) {
      await softStep(`tools/call ${name}`, async () => {
        const result = await client.callTool({ name, arguments: {} })
        const text = Array.isArray(result.content)
          ? result.content
              .map((part) => (part.type === 'text' ? part.text : ''))
              .join(' ')
          : ''
        if (result.isError) throw new Error(text || 'isError sem mensagem')
        return { detail: shortDetail(text.split('\n', 1)[0] ?? '', 60) }
      })
    }

    await softStep('resources/list', async () => {
      const { resources, nextCursor } = await client.listResources()
      return {
        detail: `${resources.length} resources${nextCursor ? ' (com próxima página)' : ''}`,
      }
    })

    await softStep('prompts/list', async () => {
      const { prompts } = await client.listPrompts()
      return { detail: prompts.map((p) => p.name).join(', ') || 'nenhum' }
    })
  } finally {
    await client.close().catch(() => undefined)
  }
}

/** Revokes the smoke grant and checks the token stops working. */
async function revoke(
  config: OAuthSmokeConfig,
  session: OAuthSession,
): Promise<void> {
  await softStep('revogar concessão', async () => {
    const headers = {
      Origin: config.origin,
      accept: 'application/json',
      Cookie: session.cookie,
    }
    const list = await fetch(
      `${config.origin}/api/users/me/integration-grants`,
      {
        headers,
      },
    )
    const body = (await readJson(list)) as {
      data?: { id: string; client: { clientId: string } }[]
    } | null
    expectStatus(list, body)
    const grant = body?.data?.find(
      (g) => g.client.clientId === session.clientId,
    )
    if (!grant) throw new Error('Concessão do smoke não encontrada')
    const response = await fetch(
      `${config.origin}/api/users/me/integration-grants/${grant.id}`,
      { method: 'DELETE', headers },
    )
    expectStatus(response, await readJson(response))
    return { detail: `concessão ${grant.id} revogada` }
  })

  await softStep('token revogado → 401', async () => {
    const response = await fetch(config.mcpUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    if (response.status !== 401) throw new Error(`HTTP ${response.status}`)
    return { detail: 'recusado como esperado' }
  })
}

async function main(): Promise<number> {
  const parsed = parseSmokeArgs(process.argv.slice(2), process.env)
  if (!parsed.ok) {
    console.error(parsed.error)
    return 2
  }
  const config = parsed.value
  console.log(`Steel MCP smoke → ${config.mcpUrl} (${config.mode})\n`)

  try {
    await checkChallenge(config)
    if (config.mode === 'token') {
      await runMcp(config, config.token)
    } else {
      const session = await oauthToken(config)
      try {
        await runMcp(config, session.accessToken)
      } finally {
        if (!config.keep) await revoke(config, session)
      }
    }
  } catch (error) {
    if (!(error instanceof StepError)) throw error
  }

  console.log(formatSmokeTable(steps))
  return smokeExitCode(steps)
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error)
    process.exit(1)
  },
)
