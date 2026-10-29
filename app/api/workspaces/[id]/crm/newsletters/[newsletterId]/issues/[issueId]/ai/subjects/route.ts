import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { aiMessageLimiter, consume } from '@/src/lib/rate-limit'
import { CrmNewsletterAiSubjectsSchema } from '@/src/schemas/crm-newsletter-ai.schema'
import { CrmNewsletterAiService } from '@/src/services/crm-newsletter-ai.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; newsletterId: string; issueId: string }>
}

/** "Sugerir assuntos": 5 subjects + preheaders from the issue copy. */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(aiMessageLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, newsletterId, issueId } = await ctx.params
  const json = await readJsonBody(request, { allowEmpty: true })
  if (!json.ok) return handleError(json.error)
  const parsed = CrmNewsletterAiSubjectsSchema.safeParse(json.value ?? {})
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmNewsletterAiService.subjects(
    auth.value.user.id,
    id,
    newsletterId,
    issueId,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
