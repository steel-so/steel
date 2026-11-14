import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import {
  CreateSdTicketFromSourceSchema,
  SdTicketSourceQuerySchema,
} from '@/src/schemas/sd-ticket-source.schema'
import { SdTicketSourceService } from '@/src/services/sd-ticket-source.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/** Prefill of the "Criar chamado" dialog (title, description, requester match). */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id } = await ctx.params
  const params = new URL(request.url).searchParams
  const parsed = SdTicketSourceQuerySchema.safeParse({
    source: params.get('source'),
    sourceId: params.get('sourceId'),
  })
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Parâmetros inválidos',
      parsed.error.issues,
    )
  }

  const result = await SdTicketSourceService.preview(
    auth.value.user.id,
    id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Opens a ticket from a zap conversation or a CRM lead, person or opportunity. */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'POST /api/workspaces/[id]/servicedesk/tickets/from-source',
  )
  if (!consent.ok) return handleError(consent.error)

  const [{ id }, json] = await Promise.all([ctx.params, readJsonBody(request)])
  if (!json.ok) return handleError(json.error)
  const parsed = CreateSdTicketFromSourceSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await SdTicketSourceService.create(
    auth.value.user.id,
    id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value, 201)
})
