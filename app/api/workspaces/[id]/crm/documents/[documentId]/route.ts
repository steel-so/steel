import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { pickSentSettings } from '@/src/lib/documents/settings'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { UpdateDocumentSchema } from '@/src/schemas/document.schema'
import { DocumentService } from '@/src/services/document.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; documentId: string }> }

export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, documentId } = await ctx.params
  const result = await DocumentService.get(auth.value.user.id, id, documentId)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

export const PATCH = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'PATCH /api/workspaces/[id]/crm/documents/[documentId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const [{ id, documentId }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request),
  ])
  if (!json.ok) return handleError(json.error)
  const parsed = UpdateDocumentSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  // Zod fills absent settings with defaults: keep only what was sent.
  const raw = json.value as { settings?: unknown }
  const result = await DocumentService.update(
    auth.value.user.id,
    id,
    documentId,
    {
      ...parsed.data,
      settings: pickSentSettings(parsed.data.settings, raw.settings),
    },
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Soft delete (OWNER/ADMIN, like the legacy proposals). */
export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'DELETE /api/workspaces/[id]/crm/documents/[documentId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, documentId } = await ctx.params
  const result = await DocumentService.remove(
    auth.value.user.id,
    id,
    documentId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(null, 200)
})
