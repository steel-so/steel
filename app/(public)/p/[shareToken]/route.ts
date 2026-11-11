import { type NextRequest, NextResponse } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import { DocumentLegacyImportService } from '@/src/services/document-legacy-import.service'

type Params = { params: Promise<{ shareToken: string }> }

/**
 * Old public proposal link → the document link with the same token
 * (ADR 0063). A proposal the migration hasn't reached yet is converted
 * now; `/d/<token>` answers for unknown or unsent links. A route handler
 * (not a page) so the redirect is a real 307.
 */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const { shareToken } = await ctx.params
  await DocumentLegacyImportService.ensurePublicToken(shareToken)
  const url = new URL(`/d/${encodeURIComponent(shareToken)}`, BETTER_AUTH_URL)
  return NextResponse.redirect(url, 307)
})
