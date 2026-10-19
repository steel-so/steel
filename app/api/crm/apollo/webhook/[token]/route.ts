import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { consume, whatsappWebhookLimiter } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { ApolloPhoneWebhookSchema } from '@/src/schemas/crm-apollo.schema'
import { CrmApolloPhoneWebhookService } from '@/src/services/crm-apollo-phone-webhook.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

/**
 * Phone numbers revealed by Apollo (`reveal_phone_number=true`), posted a few
 * minutes after the import call. Public: the secret `token` in the URL (the
 * import's derived token, only its hash is stored) authenticates the call.
 * Apollo may redeliver, so applying a payload twice is a no-op.
 */
export const POST = withAxiom(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ token: string }> },
  ) => {
    const limit = await consume(
      whatsappWebhookLimiter,
      `apollo:${getClientIp(request)}`,
    )
    if (!limit.ok) return handleError(limit.error)

    const body = await request.json().catch(() => null)
    const parsed = ApolloPhoneWebhookSchema.safeParse(body)
    if (!parsed.success) {
      return standardError(
        'VALIDATION_ERROR',
        'Dados inválidos',
        parsed.error.issues,
      )
    }

    const { token } = await params
    const result = await CrmApolloPhoneWebhookService.handle(token, parsed.data)
    if (!result.ok) return handleError(result.error)
    return successResponse({ received: result.value.received })
  },
)
