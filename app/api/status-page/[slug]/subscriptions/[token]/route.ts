import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { guardPublicStatusRoute } from '@/src/lib/servicedesk/public-status-route'
import { SdStatusSubscriptionActionSchema } from '@/src/schemas/sd-status-page.schema'
import { SdStatusPageService } from '@/src/services/sd-status-page.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ slug: string; token: string }> }

/** State of one subscription (the token in the e-mail is the access). */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const guard = await guardPublicStatusRoute(request, await ctx.params)
  if (!guard.ok) return handleError(guard.error)

  const result = await SdStatusPageService.subscription(
    guard.value.slug,
    guard.value.token as string,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})

/** Confirms or cancels the subscription (a click, never a GET). */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const guard = await guardPublicStatusRoute(request, await ctx.params)
  if (!guard.ok) return handleError(guard.error)

  const json = await readJsonBody(request)
  if (!json.ok) return handleError(json.error)
  const parsed = SdStatusSubscriptionActionSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await SdStatusPageService.actOnSubscription(
    guard.value.slug,
    guard.value.token as string,
    parsed.data.action,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})
