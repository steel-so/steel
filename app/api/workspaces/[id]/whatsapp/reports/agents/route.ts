import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { WhatsAppAgentReportQuerySchema } from '@/src/schemas/whatsapp-agent-report.schema'
import { WhatsAppAgentReportService } from '@/src/services/whatsapp-agent-report.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/**
 * Agent performance report (ADR 0062) of the period: `from`/`to` are
 * `YYYY-MM-DD` days in America/Sao_Paulo, default the last 7 days.
 * `?format=csv` downloads the spreadsheet. 404 while the platform admin has
 * not enabled the report for the workspace.
 */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id } = await ctx.params
  const parsed = WhatsAppAgentReportQuerySchema.safeParse(
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
    const csv = await WhatsAppAgentReportService.reportCsv(
      auth.value.user.id,
      id,
      parsed.data,
    )
    if (!csv.ok) return handleError(csv.error)
    return new Response(csv.value.csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${csv.value.fileName}"`,
      },
    })
  }

  const result = await WhatsAppAgentReportService.report(
    auth.value.user.id,
    id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})
