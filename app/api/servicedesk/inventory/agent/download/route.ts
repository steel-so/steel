import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { sdInventoryTokenInvalid } from '@/src/errors'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import {
  SdInventoryAgentDownloadQuerySchema,
  SdInventoryTokenValueSchema,
} from '@/src/schemas/sd-inventory.schema'
import { SdInventoryAgentUpdateService } from '@/src/services/sd-inventory-agent-update.service'
import { handleError, standardError } from '@/utils/http-response'

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
 * Baixa o binário publicado do agente. Mesmo acesso da consulta de versão
 * (token do agente); o MinIO nunca é exposto. O SHA-256 vai no cabeçalho
 * `X-Content-SHA256` e o agente o confere antes de trocar o executável.
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

  const parsed = SdInventoryAgentDownloadQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  )
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Pedido de download inválido',
      parsed.error.issues,
    )
  }

  const result = await SdInventoryAgentUpdateService.download(
    token,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return new Response(new Uint8Array(result.value.body), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(result.value.body.length),
      'Content-Disposition': `attachment; filename="${result.value.filename}"`,
      'X-Content-SHA256': result.value.sha256,
      'Cache-Control': 'no-store',
    },
  })
})
