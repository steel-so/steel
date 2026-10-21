import { signButtonWebhook } from './button-webhook'
import { assertPublicHttpsUrl } from './outbound-url'

export const AI_CAMPAIGN_WEBHOOK_TIMEOUT_MS = 10_000
export const AI_CAMPAIGN_WEBHOOK_EVENT = 'whatsapp.ai_campaign.action'

/** JSON body of the `WEBHOOK` campaign action. */
export interface AiCampaignWebhookBody {
  event: typeof AI_CAMPAIGN_WEBHOOK_EVENT
  workspaceId: string
  campaign: { id: string; name: string }
  action: { id: string; label: string }
  conversationId: string
  contact: { waId: string; name: string | null }
  /** Why the AI ran the action. */
  reason: string
  /** The fields the admin asked the AI to extract from the conversation. */
  fields: Record<string, string>
  occurredAt: string
}

/**
 * POSTs the action to the workspace's endpoint: public HTTPS only (SSRF
 * guard), no redirects, 10 s timeout, `X-Steel-Signature` (HMAC-SHA256 of
 * the raw body) when a secret is set. Throws on a refused URL, a network
 * failure or a non-2xx answer.
 */
export async function postAiCampaignWebhook(input: {
  url: string
  secret?: string
  body: AiCampaignWebhookBody
}): Promise<{ status: number }> {
  const url = await assertPublicHttpsUrl(input.url)
  const raw = JSON.stringify(input.body)
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(AI_CAMPAIGN_WEBHOOK_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Steel-Webhooks/1.0',
      'X-Steel-Event': AI_CAMPAIGN_WEBHOOK_EVENT,
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
