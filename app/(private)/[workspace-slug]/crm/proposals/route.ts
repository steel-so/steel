import { type NextRequest, NextResponse } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { BETTER_AUTH_URL } from '@/lib/env/server'

type Params = { params: Promise<{ 'workspace-slug': string }> }

/**
 * Propostas moved to CRM > Documentos (ADR 0063): a proposal is a kind. A
 * route handler (not a page) so the redirect is a real 307 even when the
 * CRM layout streams.
 */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const { 'workspace-slug': slug } = await ctx.params
  const url = new URL(`/${slug}/crm/documents`, BETTER_AUTH_URL)
  url.searchParams.set('kind', 'PROPOSAL')
  return NextResponse.redirect(url, 307)
})
