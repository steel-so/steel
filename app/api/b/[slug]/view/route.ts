import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { geolocateRequest } from '@/src/lib/analytics/geoip'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { clientIp } from '@/src/lib/sites/visitor'
import { RecordBioViewSchema } from '@/src/schemas/bio-link.schema'
import { BioLinkPublicService } from '@/src/services/bio-link-public.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ slug: string }> }

/** Page-view beacon of a published bio page. Public (no session, no cookie):
 * the visitor becomes a daily hash and the referrer keeps only its host. */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const ip = clientIp(request.headers.get('x-forwarded-for'))

  const limit = await consume(apiLimiter, `ip:${ip}`)
  if (!limit.ok) return handleError(limit.error)

  const { slug } = await ctx.params
  const json = await readJsonBody(request, { allowEmpty: true })
  if (!json.ok) return handleError(json.error)
  const parsed = RecordBioViewSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const geo = await geolocateRequest(request.headers)
  const result = await BioLinkPublicService.recordView(
    slug,
    {
      ip,
      userAgent: request.headers.get('user-agent') ?? '',
      host: request.headers.get('host'),
      country: geo?.countryCode ?? null,
    },
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(null, 202)
})
