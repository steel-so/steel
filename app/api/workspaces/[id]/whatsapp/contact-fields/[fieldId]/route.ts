import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { UpdateWhatsAppContactFieldSchema } from '@/src/schemas/whatsapp-contact-field.schema'
import { WhatsAppContactFieldService } from '@/src/services/whatsapp-contact-field.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; fieldId: string }> }

export const PATCH = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'PATCH /api/workspaces/[id]/whatsapp/contact-fields/[fieldId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const [{ id, fieldId }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request),
  ])
  if (!json.ok) return handleError(json.error)
  const parsed = UpdateWhatsAppContactFieldSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await WhatsAppContactFieldService.update(
    auth.value.user.id,
    id,
    fieldId,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'DELETE /api/workspaces/[id]/whatsapp/contact-fields/[fieldId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, fieldId } = await ctx.params
  const result = await WhatsAppContactFieldService.remove(
    auth.value.user.id,
    id,
    fieldId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(null, 200)
})
