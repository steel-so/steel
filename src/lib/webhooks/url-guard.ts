import { webhookUrlNotAllowed } from '@/src/errors'
import type { AppError } from '@/src/errors/app-error'
import {
  assertPublicHttpsUrl,
  OutboundUrlError,
} from '@/src/lib/whatsapp/outbound-url'

/**
 * SSRF guard of the webhook endpoints (ADR 0036): reuses the guard of the
 * WhatsApp button webhooks — HTTPS only, no credentials in the URL, and the
 * host (literal or every resolved address) must be public. Checked when the
 * URL is saved and again before every attempt (DNS may change); the request
 * itself never follows redirects.
 */

export type WebhookUrlRefusal =
  | 'invalid_url'
  | 'not_https'
  | 'credentials_in_url'
  | 'private_host'
  | 'dns_failed'

const MESSAGES: Record<WebhookUrlRefusal, string> = {
  invalid_url: 'URL inválida.',
  not_https: 'A URL precisa começar com https://.',
  credentials_in_url: 'Não coloque usuário e senha na URL.',
  private_host:
    'A URL aponta para um endereço privado, local ou de loopback. Use um endereço público.',
  dns_failed: 'Não foi possível resolver o domínio da URL.',
}

export type WebhookUrlCheck =
  | { ok: true; url: URL }
  | { ok: false; reason: WebhookUrlRefusal }

export async function checkWebhookUrl(raw: string): Promise<WebhookUrlCheck> {
  try {
    return { ok: true, url: await assertPublicHttpsUrl(raw) }
  } catch (cause) {
    const reason =
      cause instanceof OutboundUrlError && cause.message in MESSAGES
        ? (cause.message as WebhookUrlRefusal)
        : 'invalid_url'
    return { ok: false, reason }
  }
}

/** `WEBHOOK_URL_NOT_ALLOWED` with the pt-BR reason. */
export function webhookUrlError(reason: WebhookUrlRefusal): AppError {
  return webhookUrlNotAllowed(MESSAGES[reason])
}
