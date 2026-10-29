import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { guardPublicStatusRoute } from '@/src/lib/servicedesk/public-status-route'
import { SubscribeSdStatusPageSchema } from '@/src/schemas/sd-status-page.schema'
import { SdStatusPageService } from '@/src/services/sd-status-page.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ slug: string }> }

/** E-mail subscription (double opt-in): always answers 202 on success. */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const guard = await guardPublicStatusRoute(request, await ctx.params)
  if (!guard.ok) return handleError(guard.error)

  const json = await readJsonBody(request)
  if (!json.ok) return handleError(json.error)
  const parsed = SubscribeSdStatusPageSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await SdStatusPageService.subscribe(
    guard.value.slug,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse({ pendingConfirmation: true }, 202)
})
