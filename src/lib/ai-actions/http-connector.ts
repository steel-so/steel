import { createHash } from 'node:crypto'
import {
  type AppError,
  aiActionConnectorFailed,
  aiActionConnectorInvalid,
} from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { checkWebhookUrl, webhookUrlError } from '@/src/lib/webhooks/url-guard'
import type { AiActionParam } from '@/src/schemas/ai-action.schema'

/**
 * Generic HTTP action: the one way the AI reaches a customer system
 * (orders, password reset, access). No vendor is hard-coded — an admin
 * registers a connector and the request is built from it. Same SSRF guard
 * as the webhooks (HTTPS only, public hosts only, checked on every call),
 * no redirects, 10 s timeout, capped response.
 */

export const CONNECTOR_TIMEOUT_MS = 10_000
export const CONNECTOR_RESPONSE_MAX_CHARS = 8_000
export const CONNECTOR_USER_AGENT = 'Steel-Actions/1.0'

export interface ConnectorRequestSpec {
  method: string
  urlTemplate: string
  params: AiActionParam[]
}

export interface ConnectorRequest {
  url: string
  method: string
  body: string | null
}

type Scalar = string | number | boolean

/** Builds URL and body from the model's arguments, rejecting anything undeclared. */
export function buildConnectorRequest(
  spec: ConnectorRequestSpec,
  args: Record<string, Scalar>,
): Result<ConnectorRequest, AppError> {
  const declared = new Map(spec.params.map((p) => [p.name, p]))
  for (const name of Object.keys(args)) {
    if (!declared.has(name)) {
      return err(aiActionConnectorInvalid(`Parâmetro desconhecido: ${name}`))
    }
  }
  for (const param of spec.params) {
    if (param.required && (args[param.name] === undefined || args[param.name] === '')) {
      return err(aiActionConnectorInvalid(`Informe o parâmetro ${param.name}`))
    }
  }

  const used = new Set<string>()
  const url = spec.urlTemplate.replaceAll(/\{([^}]*)\}/g, (_m, name: string) => {
    used.add(name)
    return encodeURIComponent(String(args[name] ?? ''))
  })

  const rest = Object.entries(args).filter(([name]) => !used.has(name))
  if (spec.method === 'GET' || spec.method === 'DELETE') {
    if (rest.length === 0) return ok({ url, method: spec.method, body: null })
    const target = new URL(url)
    for (const [name, value] of rest) target.searchParams.set(name, String(value))
    return ok({ url: target.toString(), method: spec.method, body: null })
  }
  return ok({
    url,
    method: spec.method,
    body: rest.length > 0 ? JSON.stringify(Object.fromEntries(rest)) : null,
  })
}

/** Stable key: the same call (connector + arguments + scope) hashes the same. */
export function deriveIdempotencyKey(parts: {
  workspaceId: string
  connectorKey: string
  params: Record<string, Scalar>
  scope?: string | null
}): string {
  const sorted = Object.fromEntries(
    Object.entries(parts.params).sort(([a], [b]) => a.localeCompare(b)),
  )
  return createHash('sha256')
    .update(
      JSON.stringify([
        parts.workspaceId,
        parts.connectorKey,
        sorted,
        parts.scope ?? '',
      ]),
    )
    .digest('hex')
}

export interface ConnectorResponse {
  ok: boolean
  status: number
  body: unknown
}

/** Validates the final URL against the SSRF guard. */
export async function guardConnectorUrl(
  url: string,
): Promise<Result<URL, AppError>> {
  const checked = await checkWebhookUrl(url)
  if (!checked.ok) return err(webhookUrlError(checked.reason))
  return ok(checked.url)
}

function parseBody(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** One HTTP call. Never throws; network trouble becomes `AI_ACTION_CONNECTOR_FAILED`. */
export async function callConnector(input: {
  request: ConnectorRequest
  headers: Record<string, string>
  idempotencyKey: string | null
  fetchImpl?: typeof fetch
}): Promise<Result<ConnectorResponse, AppError>> {
  const guarded = await guardConnectorUrl(input.request.url)
  if (!guarded.ok) return guarded
  const doFetch = input.fetchImpl ?? fetch
  try {
    const response = await doFetch(guarded.value, {
      method: input.request.method,
      redirect: 'manual',
      signal: AbortSignal.timeout(CONNECTOR_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'User-Agent': CONNECTOR_USER_AGENT,
        ...(input.request.body ? { 'Content-Type': 'application/json' } : {}),
        ...input.headers,
        ...(input.idempotencyKey
          ? { 'Idempotency-Key': input.idempotencyKey }
          : {}),
      },
      ...(input.request.body ? { body: input.request.body } : {}),
    })
    const text = (await response.text()).slice(0, CONNECTOR_RESPONSE_MAX_CHARS)
    return ok({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      body: parseBody(text),
    })
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : ''
    return err(
      aiActionConnectorFailed(
        name === 'TimeoutError' || name === 'AbortError'
          ? 'O sistema externo demorou demais para responder.'
          : 'Não foi possível falar com o sistema externo.',
      ),
    )
  }
}
