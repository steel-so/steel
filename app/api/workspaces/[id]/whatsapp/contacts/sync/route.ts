import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { WhatsAppContactSyncService } from '@/src/services/whatsapp-contact-sync.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

export const POST = withAxiom(async (_request, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'POST /api/workspaces/[id]/whatsapp/contacts/sync',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id } = await ctx.params
  const result = await WhatsAppContactSyncService.syncPhonebook(
    auth.value.user.id,
    id,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
