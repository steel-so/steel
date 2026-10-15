import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { CrmEmailTemplateVersionService } from '@/src/services/crm-email-template-version.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; templateId: string; versionId: string }>
}

/** One version with its document (preview in the history drawer). */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, templateId, versionId } = await ctx.params
  const result = await CrmEmailTemplateVersionService.get(
    auth.value.user.id,
    id,
    templateId,
    versionId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
