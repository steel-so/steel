import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { ScanCrmDuplicatesSchema } from '@/src/schemas/crm-duplicate.schema'
import { CrmDuplicateService } from '@/src/services/crm-duplicate.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'POST /api/workspaces/[id]/crm/duplicates/scan',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id } = await ctx.params
  const json = await readJsonBody(request)
  const parsed = ScanCrmDuplicatesSchema.safeParse(json.ok ? json.value : {})
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmDuplicateService.scan(
    auth.value.user.id,
    id,
    parsed.data.entity,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
