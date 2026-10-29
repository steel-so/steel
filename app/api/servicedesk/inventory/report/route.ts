import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import {
  sdInventoryPayloadInvalid,
  sdInventoryTokenInvalid,
} from '@/src/errors'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import {
  SdInventoryReportSchema,
  SdInventoryTokenValueSchema,
} from '@/src/schemas/sd-inventory.schema'
import { SdInventoryIngestService } from '@/src/services/sd-inventory-ingest.service'
import { parseJson } from '@/utils/http-request'
import { handleError, successResponse } from '@/utils/http-response'

/** Teto do corpo: 5.000 programas cabem folgados em 2 MB. */
const MAX_BODY_BYTES = 2 * 1024 * 1024

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  )
}

/** Token do cabeçalho `Authorization: Bearer <token>`. */
function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  return match?.[1] ?? null
}

/**
 * Entrada pública do agente de inventário — sem sessão, o token do workspace
 * (`Authorization: Bearer`) é o acesso; `/api/servicedesk/inventory` está em
 * `PUBLIC_ROUTES`. Limites: rate limit por IP e corpo de até 2 MB.
 */
export const POST = withAxiom(async (request: NextRequest) => {
  const limit = await consume(apiLimiter, `sd-inventory:${clientIp(request)}`)
  if (!limit.ok) return handleError(limit.error)

  const token = bearerToken(request)
  if (!token || !SdInventoryTokenValueSchema.safeParse(token).success) {
    return handleError(sdInventoryTokenInvalid())
  }

  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return handleError(sdInventoryPayloadInvalid('Relatório grande demais'))
  }

  let text: string
  try {
    text = await request.text()
  } catch {
    return handleError(sdInventoryPayloadInvalid())
  }
  if (text.length > MAX_BODY_BYTES) {
    return handleError(sdInventoryPayloadInvalid('Relatório grande demais'))
  }
  const json = parseJson(text)
  if (!json.ok) return handleError(sdInventoryPayloadInvalid())

  const parsed = SdInventoryReportSchema.safeParse(json.value)
  if (!parsed.success) {
    return handleError(
      sdInventoryPayloadInvalid(
        parsed.error.issues[0]?.message
          ? `Relatório inválido: ${parsed.error.issues[0].path.join('.')}`
          : undefined,
      ),
    )
  }

  const result = await SdInventoryIngestService.ingest(token, parsed.data)
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})
