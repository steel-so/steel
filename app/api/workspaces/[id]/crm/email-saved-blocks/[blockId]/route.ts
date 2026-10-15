import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { UpdateCrmEmailSavedBlockSchema } from '@/src/schemas/crm-email-editor.schema'
import { CrmEmailSavedBlockService } from '@/src/services/crm-email-saved-block.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; blockId: string }> }

/** Renames a saved block or moves it to another category. */
export const PATCH = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'PATCH /api/workspaces/[id]/crm/email-saved-blocks/[blockId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const [{ id, blockId }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request),
  ])
  if (!json.ok) return handleError(json.error)
  const parsed = UpdateCrmEmailSavedBlockSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmEmailSavedBlockService.update(
    auth.value.user.id,
    id,
    blockId,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'DELETE /api/workspaces/[id]/crm/email-saved-blocks/[blockId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, blockId } = await ctx.params
  const result = await CrmEmailSavedBlockService.remove(
    auth.value.user.id,
    id,
    blockId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(null, 200)
})
