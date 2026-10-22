import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { WhatsAppSlaReportQuerySchema } from '@/src/schemas/whatsapp-sla.schema'
import { WhatsAppSlaService } from '@/src/services/whatsapp-sla.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/**
 * SLA report of the period (`from`/`to` as `YYYY-MM-DD` in America/Sao_Paulo,
 * default last 30 days). `?format=csv` downloads the CSV.
 */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id } = await ctx.params
  const parsed = WhatsAppSlaReportQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  )
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Parâmetros inválidos',
      parsed.error.issues,
    )
  }

  if (parsed.data.format === 'csv') {
    const csv = await WhatsAppSlaService.reportCsv(
      auth.value.user.id,
      id,
      parsed.data,
    )
    if (!csv.ok) return handleError(csv.error)
    return new Response(csv.value, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="relatorio-sla.csv"',
      },
    })
  }

  const result = await WhatsAppSlaService.report(
    auth.value.user.id,
    id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
