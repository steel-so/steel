import { type NextRequest, NextResponse } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { geolocateRequest } from '@/src/lib/analytics/geoip'
import {
  absoluteBioDestination,
  bioLinkPublicUrl,
} from '@/src/lib/bio-link/url'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { clientIp } from '@/src/lib/sites/visitor'
import { BioLinkPublicService } from '@/src/services/bio-link-public.service'

type Params = { params: Promise<{ slug: string; linkId: string }> }

/**
 * Tracked redirect of a bio button (`/b/<slug>/l/<id>`). The destination is
 * resolved from the saved page at click time (so a hidden or removed button
 * stops working at once), the click is counted anonymously and the visitor is
 * sent on with a 302. A rate-limited client still gets redirected, just not
 * counted. An unknown button returns the visitor to the bio page.
 */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const { slug, linkId } = await ctx.params
  const ip = clientIp(request.headers.get('x-forwarded-for'))

  const limit = await consume(apiLimiter, `ip:${ip}`)
  const geo = await geolocateRequest(request.headers)

  const result = await BioLinkPublicService.resolveClick(slug, linkId, {
    ip,
    userAgent: request.headers.get('user-agent') ?? '',
    host: request.headers.get('host'),
    country: geo?.countryCode ?? null,
    pageUrl: request.headers.get('referer'),
    record: limit.ok,
  })

  const headers = {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  }
  if (!result.ok) {
    return new NextResponse(null, { status: 404, headers })
  }
  const target = result.value
    ? absoluteBioDestination(result.value)
    : bioLinkPublicUrl(slug)
  return NextResponse.redirect(target, { status: 302, headers })
})
