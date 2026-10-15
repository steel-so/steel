import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import {
  CreateCrmEmailSavedBlockSchema,
  ListCrmEmailSavedBlocksQuerySchema,
} from '@/src/schemas/crm-email-editor.schema'
import { CrmEmailSavedBlockService } from '@/src/services/crm-email-saved-block.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/** Saved blocks of the e-mail editor ("Salvos"), optionally searched. */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id } = await ctx.params
  const query = ListCrmEmailSavedBlocksQuerySchema.safeParse({
    q: new URL(request.url).searchParams.get('q') ?? undefined,
  })
  if (!query.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      query.error.issues,
    )
  }

  const result = await CrmEmailSavedBlockService.list(
    auth.value.user.id,
    id,
    query.data.q,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Saves a section or block of the editor for the whole workspace. */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'POST /api/workspaces/[id]/crm/email-saved-blocks',
  )
  if (!consent.ok) return handleError(consent.error)

  const [{ id }, json] = await Promise.all([ctx.params, readJsonBody(request)])
  if (!json.ok) return handleError(json.error)
  const parsed = CreateCrmEmailSavedBlockSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmEmailSavedBlockService.create(
    auth.value.user.id,
    id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value, 201)
})
