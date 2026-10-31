import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import {
  ECOM_TRIGGER_KINDS,
  UpsertEcomTriggerSchema,
} from '@/src/schemas/whatsapp-commerce.schema'
import { WhatsAppStoreService } from '@/src/services/whatsapp-store.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; kind: string }> }

export const PUT = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const [{ id, kind }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request, { allowEmpty: true }),
  ])
  const triggerKind = ECOM_TRIGGER_KINDS.find((value) => value === kind)
  if (!triggerKind) {
    return standardError('VALIDATION_ERROR', 'Tipo de gatilho desconhecido')
  }
  if (!json.ok) return handleError(json.error)
  const parsed = UpsertEcomTriggerSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await WhatsAppStoreService.upsertTrigger(
    auth.value.user.id,
    id,
    triggerKind,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
