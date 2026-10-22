import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { currentMonthRange } from '@/src/lib/whatsapp/cost'
import { WhatsAppCostQuerySchema } from '@/src/schemas/whatsapp-cost.schema'
import { WhatsAppCostService } from '@/src/services/whatsapp-cost.service'
import { handleError, standardError } from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/** CSV of the cost analysis for the chosen period (OWNER/ADMIN). */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id } = await ctx.params
  const { searchParams } = new URL(request.url)
  const defaults = currentMonthRange()
  const parsed = WhatsAppCostQuerySchema.safeParse({
    from: searchParams.get('from') ?? defaults.from,
    to: searchParams.get('to') ?? defaults.to,
    connectionId: searchParams.get('connectionId') ?? undefined,
  })
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await WhatsAppCostService.exportCsv(
    auth.value.user.id,
    id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return new Response(result.value, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="custos-whatsapp-${parsed.data.from}-${parsed.data.to}.csv"`,
    },
  })
})
