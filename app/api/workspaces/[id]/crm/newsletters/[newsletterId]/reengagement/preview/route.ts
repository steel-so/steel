import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { CrmNewsletterReengagementPreviewQuerySchema } from '@/src/schemas/crm-newsletter-automation.schema'
import { CrmNewsletterReengagementService } from '@/src/services/crm-newsletter-reengagement.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; newsletterId: string }>
}

/** How many subscribers the rule would reach now (unsaved values allowed). */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, newsletterId } = await ctx.params
  const parsed = CrmNewsletterReengagementPreviewQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  )
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Parâmetros inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmNewsletterReengagementService.preview(
    auth.value.user.id,
    id,
    newsletterId,
    parsed.data,
    new Date(),
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
