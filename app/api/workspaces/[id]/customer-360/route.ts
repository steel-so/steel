import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { Customer360QuerySchema } from '@/src/schemas/customer-360.schema'
import { Customer360Service } from '@/src/services/customer-360.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/**
 * "Visão 360" of a customer: CRM, ServiceDesk and WhatsApp in one read,
 * anchored on a person, company, phone, ticket or conversation.
 */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id } = await ctx.params
  const { searchParams } = new URL(request.url)
  const parsed = Customer360QuerySchema.safeParse({
    personId: searchParams.get('personId') ?? undefined,
    companyId: searchParams.get('companyId') ?? undefined,
    phone: searchParams.get('phone') ?? undefined,
    ticketId: searchParams.get('ticketId') ?? undefined,
    conversationId: searchParams.get('conversationId') ?? undefined,
  })
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Parâmetros inválidos',
      parsed.error.issues,
    )
  }

  const result = await Customer360Service.get(
    auth.value.user.id,
    id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})
