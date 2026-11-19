import { type NextRequest, NextResponse } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { CrmGoogleConnectionService } from '@/src/services/crm-google-connection.service'

/** Back to the profile screen (or home when the workspace is unknown). */
function redirectBack(
  slug: string | null,
  status: 'connected' | 'error',
  reason?: string,
) {
  const url = slug
    ? new URL(`/${slug}/crm/google/profile`, BETTER_AUTH_URL)
    : new URL('/', BETTER_AUTH_URL)
  url.searchParams.set('google', status)
  if (reason) url.searchParams.set('reason', reason)
  return NextResponse.redirect(url, 302)
}

/** OAuth callback of the Google Business connection. */
export const GET = withAxiom(async (request: NextRequest) => {
  const auth = await getAuthSession()
  if (!auth.ok) {
    return Response.redirect(
      new URL('/sign-in', BETTER_AUTH_URL).toString(),
      302,
    )
  }

  const params = request.nextUrl.searchParams
  const state = params.get('state')
  const code = params.get('code')
  const oauthError = params.get('error')
  if (oauthError || !state || !code) {
    return redirectBack(null, 'error', oauthError ?? 'missing_params')
  }

  const result = await CrmGoogleConnectionService.completeConnect(
    auth.value.user.id,
    state,
    code,
  )
  if (!result.ok) return redirectBack(null, 'error', result.error.code)

  return redirectBack(result.value.workspaceSlug, 'connected')
})
