import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import {
  LinkCustomerSchema,
  UnlinkCustomerQuerySchema,
} from '@/src/schemas/customer-link.schema'
import { CustomerLinkService } from '@/src/services/customer-link.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/** Links a ServiceDesk / WhatsApp record to a CRM company or person. */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'POST /api/workspaces/[id]/crm/customer-links',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id } = await ctx.params
  const json = await readJsonBody(request)
  if (!json.ok) return handleError(json.error)
  const parsed = LinkCustomerSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await CustomerLinkService.link(
    auth.value.user.id,
    id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse({ linked: true })
})

/** Removes the stored link (`?kind=&id=`). */
export const DELETE = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'DELETE /api/workspaces/[id]/crm/customer-links',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id } = await ctx.params
  const { searchParams } = new URL(request.url)
  const parsed = UnlinkCustomerQuerySchema.safeParse({
    kind: searchParams.get('kind') ?? undefined,
    id: searchParams.get('id') ?? undefined,
  })
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Parâmetros inválidos',
      parsed.error.issues,
    )
  }

  const result = await CustomerLinkService.unlink(
    auth.value.user.id,
    id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse({ linked: false })
})
