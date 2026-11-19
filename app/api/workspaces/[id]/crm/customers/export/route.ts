import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { queryObject } from '@/src/lib/query-object'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { CrmCustomerFiltersSchema } from '@/src/schemas/crm-customer.schema'
import { CrmCustomerService } from '@/src/services/crm-customer.service'
import { handleError, standardError } from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/** The filtered customers as CSV (audited). */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id } = await ctx.params
  const parsed = CrmCustomerFiltersSchema.safeParse(queryObject(request.url))
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? 'Parâmetros inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmCustomerService.exportCsv(
    auth.value.user.id,
    id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return new Response(result.value.csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${result.value.filename}"`,
      'Cache-Control': 'no-store',
    },
  })
})
