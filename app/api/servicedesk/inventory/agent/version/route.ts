import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { sdInventoryTokenInvalid } from '@/src/errors'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import {
  SdInventoryAgentVersionQuerySchema,
  SdInventoryTokenValueSchema,
} from '@/src/schemas/sd-inventory.schema'
import { SdInventoryAgentUpdateService } from '@/src/services/sd-inventory-agent-update.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  )
}

function bearerToken(request: NextRequest): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(
    request.headers.get('authorization') ?? '',
  )
  return match?.[1] ?? null
}

/**
 * O agente pergunta se há versão nova (`?os=&arch=&current=`). Sem sessão: o
 * token do agente é o acesso; `/api/servicedesk/inventory` é rota pública.
 */
export const GET = withAxiom(async (request: NextRequest) => {
  const limit = await consume(
    apiLimiter,
    `sd-inventory-update:${clientIp(request)}`,
  )
  if (!limit.ok) return handleError(limit.error)

  const token = bearerToken(request)
  if (!token || !SdInventoryTokenValueSchema.safeParse(token).success) {
    return handleError(sdInventoryTokenInvalid())
  }

  const parsed = SdInventoryAgentVersionQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  )
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Consulta de versão inválida',
      parsed.error.issues,
    )
  }

  const result = await SdInventoryAgentUpdateService.checkVersion(
    token,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})
