import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { CrmDashboardTvService } from '@/src/services/crm-dashboard-tv.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; dashboardId: string; linkId: string }>
}

/** Revokes a Comunicação TV link: the screen stops on the next refresh. */
export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'DELETE /api/workspaces/[id]/whatsapp/dashboards/[dashboardId]/tv-links/[linkId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, dashboardId, linkId } = await ctx.params
  const result = await CrmDashboardTvService.revokeLink(
    auth.value.user.id,
    id,
    dashboardId,
    linkId,
    'COMMUNICATION',
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(null, 200)
})
