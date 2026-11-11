import { type NextRequest, NextResponse } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { DocumentLegacyImportService } from '@/src/services/document-legacy-import.service'
import { MembershipService } from '@/src/services/membership.service'

type Params = { params: Promise<{ 'workspace-slug': string; id: string }> }

function to(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, BETTER_AUTH_URL), 307)
}

/**
 * Old proposal link → its document (ADR 0063). A proposal the migration
 * hasn't reached yet is converted now; anything else lands on the list. A
 * route handler (not a page) so the redirect is a real 307.
 */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const { 'workspace-slug': slug, id } = await ctx.params
  const list = `/${slug}/crm/documents?kind=PROPOSAL`
  if (id === 'new') return to(list)

  const session = await getAuthSession()
  if (!session.ok) return to('/sign-in')

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) {
    return new NextResponse(null, { status: 404 })
  }

  const document = await DocumentLegacyImportService.documentForProposal(
    session.value.user.id,
    membership.value.workspaceId,
    id,
  )
  return to(document.ok ? `/${slug}/crm/documents/${document.value}` : list)
})
