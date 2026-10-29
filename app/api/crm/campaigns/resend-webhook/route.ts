import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { RESEND_WEBHOOK_SECRET } from '@/lib/env/server'
import { verifyResendSignature } from '@/src/lib/crm-campaign/resend-webhook'
import { ResendWebhookEventSchema } from '@/src/schemas/crm-campaign.schema'
import { CrmCampaignTrackingService } from '@/src/services/crm-campaign-tracking.service'
import { CrmNewsletterTrackingService } from '@/src/services/crm-newsletter-tracking.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

/**
 * Resend webhook (delivered / bounced / complained / opened / clicked) for
 * CRM newsletter issues and multichannel campaigns. No session: verified by the Svix signature
 * with `RESEND_WEBHOOK_SECRET`; inert (503) when the secret is not set.
 */
export const POST = withAxiom(async (request: NextRequest) => {
  if (!RESEND_WEBHOOK_SECRET) {
    return standardError(
      'CRM_CAMPAIGN_WEBHOOK_NOT_CONFIGURED',
      'Webhook do Resend não configurado',
    )
  }

  const body = await request.text()
  const valid = verifyResendSignature({
    secret: RESEND_WEBHOOK_SECRET,
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signature: request.headers.get('svix-signature'),
    body,
    now: new Date(),
  })
  if (!valid) return standardError('UNAUTHORIZED', 'Assinatura inválida')

  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return standardError('VALIDATION_ERROR', 'JSON inválido')
  }
  const parsed = ResendWebhookEventSchema.safeParse(json)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Evento inválido',
      parsed.error.issues,
    )
  }

  // Newsletter issues first (ADR 0054), then the campaigns.
  const now = new Date()
  const newsletter = await CrmNewsletterTrackingService.onEmailEvent(
    parsed.data,
    now,
  )
  if (!newsletter.ok) return handleError(newsletter.error)
  if (newsletter.value) return successResponse({ tracked: true })

  const result = await CrmCampaignTrackingService.onEmailEvent(parsed.data, now)
  if (!result.ok) return handleError(result.error)

  return successResponse({ tracked: result.value })
})
