import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { sdMonitorPayloadInvalid, sdMonitorTokenInvalid } from '@/src/errors'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { SdMonitorTokenSchema } from '@/src/schemas/sd-monitor-source.schema'
import { SdMonitorIngestService } from '@/src/services/sd-monitor-ingest.service'
import { parseJson } from '@/utils/http-request'
import { handleError, successResponse } from '@/utils/http-response'

/** Teto do corpo do alerta (o Zabbix manda poucos KB). */
const MAX_BODY_BYTES = 64 * 1024

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  )
}

/**
 * Entrada pública do monitoramento — sem sessão, o token da origem é o
 * acesso (`/api/servicedesk/monitoring/<token>`, liberado em
 * `PUBLIC_ROUTES`). Aceita o corpo do tipo de mídia "Webhook" do Zabbix, o do Grafana/
 * Alertmanager (`alerts[]`, vários por envio), o do PRTG e o formato genérico
 * `{ externalId, status, severity, host, subject, body }`.
 *
 * Limites: rate limit por IP e corpo de até 64 KB (acima disso,
 * `SD_MONITOR_PAYLOAD_INVALID`, sem nem olhar o conteúdo).
 */
export const POST = withAxiom(
  async (request: NextRequest, ctx: { params: Promise<{ token: string }> }) => {
    const limit = await consume(apiLimiter, `sd-monitor:${clientIp(request)}`)
    if (!limit.ok) return handleError(limit.error)

    const { token } = await ctx.params
    if (!SdMonitorTokenSchema.safeParse(token).success) {
      return handleError(sdMonitorTokenInvalid())
    }

    const declared = Number(request.headers.get('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return handleError(sdMonitorPayloadInvalid('Alerta grande demais'))
    }

    let text: string
    try {
      text = await request.text()
    } catch {
      return handleError(sdMonitorPayloadInvalid())
    }
    if (text.length > MAX_BODY_BYTES) {
      return handleError(sdMonitorPayloadInvalid('Alerta grande demais'))
    }
    const json = parseJson(text)
    if (!json.ok) return handleError(sdMonitorPayloadInvalid())

    const result = await SdMonitorIngestService.ingest(token, json.value)
    if (!result.ok) return handleError(result.error)

    const toBody = (item: (typeof result.value)['results'][number]) => ({
      alertId: item.alert.id,
      status: item.alert.status,
      outcome: item.outcome,
      ticket: item.alert.ticket
        ? {
            id: item.alert.ticket.id,
            number: item.alert.ticket.number,
            code: item.ticketCode,
          }
        : null,
    })
    const { results } = result.value
    return successResponse(
      results.length > 1
        ? { ...toBody(results[0]), alerts: results.map(toBody) }
        : toBody(results[0]),
    )
  },
)
