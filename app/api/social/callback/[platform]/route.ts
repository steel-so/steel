import { type NextRequest, NextResponse } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { CrmSocialConnectionService } from '@/src/services/crm-social.service'

const PKCE_COOKIE = 'social_pkce'

/** Sem slug conhecido (ex.: `state` inválido), volta para a home autenticada. */
function redirectToSettings(
  slug: string | null,
  status: 'connected' | 'error',
  reason?: string,
) {
  const url = slug
    ? new URL(`/${slug}/settings/social`, BETTER_AUTH_URL)
    : new URL('/', BETTER_AUTH_URL)
  url.searchParams.set('social', status)
  if (reason) url.searchParams.set('reason', reason)
  const response = NextResponse.redirect(url, 302)
  response.headers.append(
    'Set-Cookie',
    `${PKCE_COOKIE}=; Path=/api/social/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  )
  return response
}

export const GET = withAxiom(async (request: NextRequest) => {
  // O callback da Meta chega no host registrado no app dela (META_PUBLIC_URL),
  // onde não há cookie de sessão. Repassa ao host canônico, que tem a sessão e
  // o cookie PKCE, preservando `code` e `state`.
  const canonical = new URL(BETTER_AUTH_URL)
  if (request.nextUrl.host !== canonical.host) {
    const target = new URL(
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
      canonical,
    )
    return NextResponse.redirect(target, 302)
  }

  const auth = await getAuthSession()
  if (!auth.ok) {
    return Response.redirect(
      new URL('/sign-in', BETTER_AUTH_URL).toString(),
      302,
    )
  }

  const searchParams = request.nextUrl.searchParams
  const state = searchParams.get('state')
  const code = searchParams.get('code')
  const oauthError = searchParams.get('error')

  if (oauthError || !state || !code) {
    return redirectToSettings(null, 'error', oauthError ?? 'missing_params')
  }

  const pkceVerifier = request.cookies.get(PKCE_COOKIE)?.value ?? null

  const result = await CrmSocialConnectionService.completeConnect(
    auth.value.user.id,
    state,
    code,
    pkceVerifier,
  )

  if (!result.ok) {
    return redirectToSettings(null, 'error', result.error.code)
  }

  return redirectToSettings(result.value.workspaceSlug, 'connected')
})
