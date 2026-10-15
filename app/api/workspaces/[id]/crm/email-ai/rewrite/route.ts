import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { aiMessageLimiter, consume } from '@/src/lib/rate-limit'
import { CrmEmailAiRewriteSchema } from '@/src/schemas/crm-email-editor.schema'
import { CrmEmailAiService } from '@/src/services/crm-email-ai.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/** Writes or rewrites the text of one e-mail block with the CRM AI. */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(aiMessageLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const [{ id }, json] = await Promise.all([ctx.params, readJsonBody(request)])
  if (!json.ok) return handleError(json.error)
  const parsed = CrmEmailAiRewriteSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmEmailAiService.rewrite(
    auth.value.user.id,
    id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
