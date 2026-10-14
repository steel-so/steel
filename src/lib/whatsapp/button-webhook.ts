import { createHmac } from 'node:crypto'
import { assertPublicHttpsUrl } from './outbound-url'

export const BUTTON_WEBHOOK_TIMEOUT_MS = 10_000
export const BUTTON_WEBHOOK_EVENT = 'whatsapp.button.clicked'

/** JSON body of the `HTTP_WEBHOOK` button action. */
export interface ButtonWebhookBody {
  event: typeof BUTTON_WEBHOOK_EVENT
  workspaceId: string
  conversationId: string
  contact: { waId: string; name: string | null }
  button: { id: string; label: string }
  source: { type: 'TEMPLATE' | 'QUICK_REPLY'; id: string }
  clickedAt: string
}

/** `sha256=<hex>` HMAC of the raw body — what `X-Steel-Signature` carries. */
export function signButtonWebhook(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`
}

/**
 * POSTs the click to the workspace's endpoint: public HTTPS only (SSRF
 * guard), no redirects, 10 s timeout. Throws on a refused URL, a network
 * failure or a non-2xx answer — the action engine logs it and moves on.
 */
export async function postButtonWebhook(input: {
  url: string
  secret?: string
  body: ButtonWebhookBody
}): Promise<{ status: number }> {
  const url = await assertPublicHttpsUrl(input.url)
  const raw = JSON.stringify(input.body)
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(BUTTON_WEBHOOK_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Steel-Webhooks/1.0',
      'X-Steel-Event': BUTTON_WEBHOOK_EVENT,
      ...(input.secret
        ? { 'X-Steel-Signature': signButtonWebhook(raw, input.secret) }
        : {}),
    },
    body: raw,
  })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`webhook_status_${response.status}`)
  }
  return { status: response.status }
}
