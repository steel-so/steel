import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import {
  ListWhatsAppAiCampaignRecipientsSchema,
  QueueWhatsAppAiCampaignSchema,
} from '@/src/schemas/whatsapp-ai-campaign.schema'
import { WhatsAppAiCampaignService } from '@/src/services/whatsapp-ai-campaign.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; campaignId: string }> }

export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, campaignId } = await ctx.params
  const search = request.nextUrl.searchParams
  const parsed = ListWhatsAppAiCampaignRecipientsSchema.safeParse({
    status: search.get('status') ?? undefined,
    search: search.get('search') ?? undefined,
    cursor: search.get('cursor') ?? undefined,
    limit: search.get('limit') ?? undefined,
  })
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await WhatsAppAiCampaignService.listRecipients(
    auth.value.user.id,
    id,
    campaignId,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Adds contacts: selected, all, or spreadsheet rows. */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const [{ id, campaignId }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request),
  ])
  if (!json.ok) return handleError(json.error)
  const parsed = QueueWhatsAppAiCampaignSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await WhatsAppAiCampaignService.queue(
    auth.value.user.id,
    id,
    campaignId,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Clears the pending contacts (`?all=true`: every contact). */
export const DELETE = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, campaignId } = await ctx.params

  const result = await WhatsAppAiCampaignService.clear(
    auth.value.user.id,
    id,
    campaignId,
    request.nextUrl.searchParams.get('all') === 'true',
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
