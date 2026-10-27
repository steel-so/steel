import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { UpdateWhatsAppArchiveSettingsSchema } from '@/src/schemas/whatsapp-archive.schema'
import { WhatsAppArchiveService } from '@/src/services/whatsapp-archive.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/** WhatsApp archive (ADR 0052) of a workspace, for the platform admin. */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id } = await ctx.params
  const result = await WhatsAppArchiveService.adminOverview(
    auth.value.user.id,
    id,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})

/** Turns the archive on/off and sets the root folder. */
export const PATCH = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'PATCH /api/admin/workspaces/[id]/whatsapp-archive',
  )
  if (!consent.ok) return handleError(consent.error)

  const [{ id }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request, { allowEmpty: true }),
  ])
  if (!json.ok) return handleError(json.error)
  const parsed = UpdateWhatsAppArchiveSettingsSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await WhatsAppArchiveService.adminUpdateSettings(
    auth.value.user.id,
    id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})
