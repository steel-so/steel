import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { CrmCadenceTrackingService } from '@/src/services/crm-cadence-tracking.service'

type Params = { params: Promise<{ token: string }> }

// 1×1 transparent GIF.
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
)

/**
 * Public open pixel of the cadence e-mails (signed token, no session). Always
 * answers the image — tracking never breaks the e-mail rendering.
 */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const { token } = await ctx.params
  await CrmCadenceTrackingService.recordOpen(token, new Date())
  return new Response(PIXEL, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, max-age=0',
    },
  })
})
