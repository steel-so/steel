import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { WaDashboardSourceSchema } from '@/src/schemas/whatsapp-dashboard.schema'
import { WhatsAppDashboardSourceService } from '@/src/services/whatsapp-dashboard-source.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; source: string }> }

/** Flattened rows of a data source of the Comunicação dashboards. */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, source } = await ctx.params
  const parsed = WaDashboardSourceSchema.safeParse(source)
  if (!parsed.success) {
    return standardError('VALIDATION_ERROR', 'Fonte de dados desconhecida')
  }

  const result = await WhatsAppDashboardSourceService.rows(
    auth.value.user.id,
    id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
