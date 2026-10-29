import { assertPublicHttpsUrl } from '@/src/lib/whatsapp/outbound-url'
import type { ChatbotWebhookRequest, ChatbotWebhookResponse } from './engine'

export const CHATBOT_WEBHOOK_TIMEOUT_MS = 8_000
/** Answers larger than this are ignored (the flow takes the error exit). */
export const CHATBOT_WEBHOOK_MAX_BYTES = 256 * 1024

/**
 * The HTTP call of an "Integração" node. Same guard as the button webhooks:
 * public HTTPS only, no redirects, short timeout. Never throws: any problem
 * is a `{ ok: false }` the flow routes through the node's error exit.
 */
export async function callChatbotWebhook(
  request: ChatbotWebhookRequest,
): Promise<ChatbotWebhookResponse> {
  try {
    const url = await assertPublicHttpsUrl(request.url)
    const response = await fetch(url, {
      method: request.method,
      redirect: 'manual',
      signal: AbortSignal.timeout(CHATBOT_WEBHOOK_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Steel-Chatbot/1.0',
        ...(request.method === 'POST'
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      ...(request.method === 'POST' && request.body !== undefined
        ? { body: JSON.stringify(request.body) }
        : {}),
    })
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, reason: `status_${response.status}` }
    }
    const raw = await response.text()
    if (raw.length > CHATBOT_WEBHOOK_MAX_BYTES) {
      return { ok: false, reason: 'response_too_large' }
    }
    if (!raw.trim()) return { ok: true, json: null }
    try {
      return { ok: true, json: JSON.parse(raw) }
    } catch {
      return { ok: true, json: raw }
    }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'request_failed',
    }
  }
}
