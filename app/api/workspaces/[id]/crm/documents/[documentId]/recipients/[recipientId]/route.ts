import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { DocumentSendService } from '@/src/services/document-send.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; documentId: string; recipientId: string }>
}

/** Removes a recipient: their personal link stops working. */
export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'DELETE /api/workspaces/[id]/crm/documents/[documentId]/recipients/[recipientId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, documentId, recipientId } = await ctx.params
  const result = await DocumentSendService.removeRecipient(
    auth.value.user.id,
    id,
    documentId,
    recipientId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(null, 200)
})
