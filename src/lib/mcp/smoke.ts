import { createHash } from 'node:crypto'

/**
 * Pure parts of `scripts/mcp-smoke.ts` (`pnpm mcp:smoke`): argument and env
 * parsing, the OAuth helpers of the `--oauth` mode, which read tools to call
 * and the pass/fail table. The script owns every network call; this module
 * never touches the network, the filesystem or `process`.
 */

export const MCP_SMOKE_MODULES = [
  'SERVICE_DESK',
  'CRM',
  'COMMUNICATION',
] as const
export type McpSmokeModule = (typeof MCP_SMOKE_MODULES)[number]

/** Loopback callback registered by the smoke client. Never listened on. */
export const MCP_SMOKE_REDIRECT_URI = 'http://127.0.0.1:33418/callback'

/**
 * Read tools the smoke prefers, in order. They take no required argument,
 * so `{}` is a valid call; the first ones the grant exposes are called.
 */
export const MCP_SMOKE_PREFERRED_TOOLS = [
  'ws_overview',
  'sd_ticket_counts',
  'crm_list_pipelines',
  'zap_dashboard',
  'sd_my_queue',
  'crm_list_leads',
  'zap_conversations_list',
] as const

export const MCP_SMOKE_USAGE = `Uso: pnpm mcp:smoke [--oauth] [--keep] [--tools=a,b,c] [--url=<base>]

Modo token (padrão):
  MCP_SMOKE_URL     endereço do Steel (ex.: https://homologacao.stratustelecom.com.br)
  MCP_SMOKE_TOKEN   access token OAuth (stl_at_...)

Modo --oauth (registro dinâmico + código com PKCE + consentimento por API):
  MCP_SMOKE_URL           (ou SMOKE_BASE)
  MCP_SMOKE_EMAIL         (ou SMOKE_EMAIL)
  MCP_SMOKE_PASSWORD      (ou SMOKE_PASSWORD)
  MCP_SMOKE_WORKSPACE_ID  id do workspace a conceder
  MCP_SMOKE_MODULES       opcional, ex.: SERVICE_DESK,CRM (padrão: os três)
  MCP_SMOKE_SCOPES        opcional, ex.: mcp:read,mcp:write (padrão: mcp:read)
  --keep                  não revoga a concessão no fim

--tools=a,b,c escolhe as ferramentas de leitura chamadas (padrão: até 3 da lista sugerida).`

interface BaseConfig {
  /** App origin, without a trailing slash. */
  origin: string
  /** `<origin>/api/mcp`. */
  mcpUrl: string
  /** Explicit tools to call; empty = pick from the preferred list. */
  tools: string[]
}

export interface TokenSmokeConfig extends BaseConfig {
  mode: 'token'
  token: string
}

export interface OAuthSmokeConfig extends BaseConfig {
  mode: 'oauth'
  email: string
  password: string
  workspaceId: string
  modules: McpSmokeModule[]
  scopes: string[]
  /** Keep the grant at the end instead of revoking it. */
  keep: boolean
}

export type McpSmokeConfig = TokenSmokeConfig | OAuthSmokeConfig

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

function fail<T>(error: string): ParseResult<T> {
  return { ok: false, error }
}

/** `https://x/api/mcp/` or `https://x/` → `{ origin, mcpUrl }`. */
export function normalizeBaseUrl(
  raw: string,
): ParseResult<{ origin: string; mcpUrl: string }> {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return fail(`Endereço inválido: ${raw}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return fail(`Endereço precisa ser http(s): ${raw}`)
  }
  const path = url.pathname.replace(/\/+$/, '').replace(/\/api\/mcp$/, '')
  const origin = `${url.origin}${path}`
  return { ok: true, value: { origin, mcpUrl: `${origin}/api/mcp` } }
}

function listOf(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function flagValue(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

/** Reads the CLI flags and the env into a config, or a pt-BR error. */
export function parseSmokeArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): ParseResult<McpSmokeConfig> {
  const known = /^--(oauth|keep|help|tools=.*|url=.*)$/
  const unknown = argv.find((arg) => !known.test(arg))
  if (unknown) return fail(`Opção desconhecida: ${unknown}`)
  if (argv.includes('--help')) return fail(MCP_SMOKE_USAGE)

  const rawUrl = flagValue(argv, 'url') ?? env.MCP_SMOKE_URL ?? env.SMOKE_BASE
  if (!rawUrl) return fail('Defina MCP_SMOKE_URL com o endereço do Steel.')
  const base = normalizeBaseUrl(rawUrl)
  if (!base.ok) return base
  const tools = listOf(flagValue(argv, 'tools'))

  if (!argv.includes('--oauth')) {
    const token = env.MCP_SMOKE_TOKEN?.trim()
    if (!token) {
      return fail('Defina MCP_SMOKE_TOKEN, ou use --oauth para obter um token.')
    }
    return { ok: true, value: { mode: 'token', ...base.value, tools, token } }
  }

  const email = env.MCP_SMOKE_EMAIL ?? env.SMOKE_EMAIL
  const password = env.MCP_SMOKE_PASSWORD ?? env.SMOKE_PASSWORD
  const workspaceId = env.MCP_SMOKE_WORKSPACE_ID?.trim()
  if (!email || !password) {
    return fail('Defina MCP_SMOKE_EMAIL e MCP_SMOKE_PASSWORD para o --oauth.')
  }
  if (!workspaceId) {
    return fail('Defina MCP_SMOKE_WORKSPACE_ID para o --oauth.')
  }

  const rawModules = listOf(env.MCP_SMOKE_MODULES)
  const modules = rawModules.length > 0 ? rawModules : [...MCP_SMOKE_MODULES]
  const badModule = modules.find(
    (module) => !(MCP_SMOKE_MODULES as readonly string[]).includes(module),
  )
  if (badModule) return fail(`Módulo desconhecido: ${badModule}`)

  const rawScopes = listOf(env.MCP_SMOKE_SCOPES)
  const scopes = rawScopes.length > 0 ? rawScopes : ['mcp:read']
  const badScope = scopes.find((s) => s !== 'mcp:read' && s !== 'mcp:write')
  if (badScope) return fail(`Escopo desconhecido: ${badScope}`)
  if (!scopes.includes('mcp:read')) {
    return fail('O escopo mcp:read é obrigatório.')
  }

  return {
    ok: true,
    value: {
      mode: 'oauth',
      ...base.value,
      tools,
      email,
      password,
      workspaceId,
      modules: [...new Set(modules)] as McpSmokeModule[],
      scopes: [...new Set(scopes)],
      keep: argv.includes('--keep'),
    },
  }
}

/** S256 code challenge (RFC 7636) of a PKCE verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/** `/oauth2/authorize` URL for the authorization code flow with PKCE. */
export function buildAuthorizeUrl(input: {
  authorizationEndpoint: string
  clientId: string
  scopes: readonly string[]
  state: string
  codeChallenge: string
  resource: string
}): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: MCP_SMOKE_REDIRECT_URI,
    // `offline_access` asks for a refresh token, like real MCP clients do.
    scope: [...input.scopes, 'offline_access'].join(' '),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    resource: input.resource,
  })
  return `${input.authorizationEndpoint}?${query}`
}

/**
 * Where `/oauth2/authorize` sends the user. A browser gets a 302; Node's
 * fetch sends `sec-fetch-mode: cors`, so the provider may answer
 * `{ redirect: true, url }` instead.
 */
export function authorizeRedirect(
  location: string | null,
  body: unknown,
  origin: string,
): string | null {
  const fromBody =
    body && typeof body === 'object' && 'url' in body
      ? (body as { url: unknown }).url
      : null
  const target = location ?? (typeof fromBody === 'string' ? fromBody : null)
  if (!target) return null
  return new URL(target, origin).toString()
}

/** The signed query the consent API expects, from the consent page URL. */
export function consentQuery(consentUrl: string): ParseResult<string> {
  const url = new URL(consentUrl)
  if (url.pathname !== '/oauth/consent') {
    return fail(`O authorize não levou ao consentimento: ${url.pathname}`)
  }
  const query = url.search.replace(/^\?/, '')
  if (!query)
    return fail('A URL de consentimento veio sem a consulta assinada.')
  return { ok: true, value: query }
}

/** Authorization code from the client callback, checking `state`. */
export function callbackCode(
  redirectUrl: string,
  expectedState: string,
): ParseResult<string> {
  const url = new URL(redirectUrl)
  const error = url.searchParams.get('error')
  if (error) {
    const description = url.searchParams.get('error_description')
    return fail(
      `O provedor recusou: ${error}${description ? ` (${description})` : ''}`,
    )
  }
  if (url.searchParams.get('state') !== expectedState) {
    return fail('O state do retorno não confere.')
  }
  const code = url.searchParams.get('code')
  if (!code) return fail('O retorno veio sem code.')
  return { ok: true, value: code }
}

/** `Set-Cookie` headers → one `Cookie` header (name=value pairs only). */
export function cookieHeader(setCookies: readonly string[]): string {
  const jar = new Map<string, string>()
  for (const raw of setCookies) {
    const pair = raw.split(';', 1)[0]?.trim() ?? ''
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    jar.set(pair.slice(0, eq), pair.slice(eq + 1))
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
}

export interface SmokeTool {
  name: string
  inputSchema?: { required?: readonly string[] }
}

/**
 * Read tools to call. Explicit names win (missing ones are reported by the
 * call itself); otherwise the first `max` preferred tools the server lists
 * that need no argument.
 */
export function pickSmokeTools(
  listed: readonly SmokeTool[],
  explicit: readonly string[],
  max = 3,
): string[] {
  if (explicit.length > 0) return [...explicit]
  const available = new Map(listed.map((tool) => [tool.name, tool]))
  return MCP_SMOKE_PREFERRED_TOOLS.filter((name) => {
    const tool = available.get(name)
    return tool !== undefined && (tool.inputSchema?.required ?? []).length === 0
  }).slice(0, max)
}

export interface SmokeStep {
  name: string
  ok: boolean
  /** Short, single-line detail (counts, error message). */
  detail: string
  durationMs: number
}

/** Collapses whitespace and truncates a detail for the table. */
export function shortDetail(text: string, max = 80): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** Plain-text pass/fail table, one row per step plus a total line. */
export function formatSmokeTable(steps: readonly SmokeStep[]): string {
  const rows = steps.map((step) => [
    step.ok ? 'PASS' : 'FAIL',
    step.name,
    `${Math.round(step.durationMs)} ms`,
    step.detail,
  ])
  const header = ['', 'Etapa', 'Tempo', 'Detalhe']
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column]?.length ?? 0)),
  )
  const line = (cells: string[]) =>
    cells
      .map((cell, column) =>
        column === cells.length - 1 ? cell : cell.padEnd(widths[column] ?? 0),
      )
      .join('  ')
      .trimEnd()
  const failed = steps.filter((step) => !step.ok).length
  const total =
    failed === 0
      ? `${steps.length} etapas, todas passaram.`
      : `${steps.length} etapas, ${failed} falharam.`
  return [line(header), ...rows.map(line), '', total].join('\n')
}

/** Process exit code: 0 only when there are steps and all passed. */
export function smokeExitCode(steps: readonly SmokeStep[]): number {
  return steps.length > 0 && steps.every((step) => step.ok) ? 0 : 1
}
