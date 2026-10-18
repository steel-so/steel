/**
 * One HTTP attempt of an outbound webhook: POST JSON, no redirects, 10 s
 * timeout. Never throws — the outcome (status, the first 1 KB of the answer,
 * duration, network error) goes to the delivery log.
 */

export const WEBHOOK_TIMEOUT_MS = 10_000
export const WEBHOOK_RESPONSE_EXCERPT = 1024
export const WEBHOOK_USER_AGENT = 'Steel-Webhooks/1.0'

export interface WebhookAttemptResult {
  ok: boolean
  status: number | null
  responseBody: string | null
  durationMs: number
  /** Network error / non-2xx status, short and in English (log field). */
  error: string | null
}

async function readExcerpt(response: Response): Promise<string | null> {
  try {
    const text = await response.text()
    return text ? text.slice(0, WEBHOOK_RESPONSE_EXCERPT) : null
  } catch {
    return null
  }
}

export async function postWebhook(input: {
  url: URL | string
  body: string
  headers: Record<string, string>
  timeoutMs?: number
  now?: () => number
}): Promise<WebhookAttemptResult> {
  const now = input.now ?? Date.now
  const started = now()
  try {
    const response = await fetch(input.url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(input.timeoutMs ?? WEBHOOK_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': WEBHOOK_USER_AGENT,
        ...input.headers,
      },
      body: input.body,
    })
    const responseBody = await readExcerpt(response)
    const ok = response.status >= 200 && response.status < 300
    return {
      ok,
      status: response.status,
      responseBody,
      durationMs: Math.max(0, now() - started),
      error: ok ? null : `http_${response.status}`,
    }
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : ''
    return {
      ok: false,
      status: null,
      responseBody: null,
      durationMs: Math.max(0, now() - started),
      error:
        name === 'TimeoutError' || name === 'AbortError'
          ? 'timeout'
          : `network_error: ${cause instanceof Error ? cause.message : String(cause)}`.slice(
              0,
              300,
            ),
    }
  }
}
