import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { CrmProposalPaymentService } from '@/src/services/crm-proposal-payment.service'
import { authorizedUser } from '@/utils/crm-deals-route'
import { handleError } from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; proposalId: string; signatureId: string }>
}

/** PNG of the customer's signature (private bucket). */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const user = await authorizedUser()
  if (!user.ok) return handleError(user.error)

  const { id, proposalId, signatureId } = await ctx.params
  const result = await CrmProposalPaymentService.signatureImage(
    user.value,
    id,
    proposalId,
    signatureId,
  )
  if (!result.ok) return handleError(result.error)

  return new Response(new Uint8Array(result.value), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(result.value.byteLength),
      'Cache-Control': 'private, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="assinatura-${signatureId}.png"`,
    },
  })
})
