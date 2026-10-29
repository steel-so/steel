import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { CrmNewsletterSubscriberService } from '@/src/services/crm-newsletter-subscriber.service'
import { handleError } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; newsletterId: string }> }

/** Every subscriber with the consent evidence, as CSV (audited). */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, newsletterId } = await ctx.params
  const result = await CrmNewsletterSubscriberService.exportCsv(
    auth.value.user.id,
    id,
    newsletterId,
  )
  if (!result.ok) return handleError(result.error)

  return new Response(result.value.csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${result.value.filename}"`,
      'Cache-Control': 'no-store',
    },
  })
})
