import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { CrmDashboardSourceSchema } from '@/src/schemas/crm-dashboard-source.schema'
import { CrmDashboardSourceService } from '@/src/services/crm-dashboard-source.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; source: string }> }

/** Flattened rows of a data source of the CRM dashboards. */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, source } = await ctx.params
  const parsed = CrmDashboardSourceSchema.safeParse(source)
  if (!parsed.success) {
    return standardError('VALIDATION_ERROR', 'Fonte de dados desconhecida')
  }

  const result = await CrmDashboardSourceService.rows(
    auth.value.user.id,
    id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
