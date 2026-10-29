import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { UpdateCrmNewsletterIssueWhatsAppSchema } from '@/src/schemas/crm-newsletter-engage.schema'
import { CrmNewsletterWhatsAppService } from '@/src/services/crm-newsletter-whatsapp.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; newsletterId: string; issueId: string }>
}

/** WhatsApp version of the issue: settings, problems and reach. */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, newsletterId, issueId } = await ctx.params
  const result = await CrmNewsletterWhatsAppService.get(
    auth.value.user.id,
    id,
    newsletterId,
    issueId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** "Enviar também no WhatsApp" (DRAFT/SCHEDULED issues). */
export const PATCH = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const body = await request.json().catch(() => null)
  const parsed = UpdateCrmNewsletterIssueWhatsAppSchema.safeParse(body)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const { id, newsletterId, issueId } = await ctx.params
  const result = await CrmNewsletterWhatsAppService.update(
    auth.value.user.id,
    id,
    newsletterId,
    issueId,
    parsed.data,
    new Date(),
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
