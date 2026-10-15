import { cookies, headers } from 'next/headers'
import type { ReactNode } from 'react'
import { COOKIE_NAME, parseCookieConsent } from '@/lib/cookie-consent/types'
import { auth } from '@/src/lib/auth'
import { SITE_REQUEST_HEADER } from '@/src/lib/sites/host'
import { TV_REQUEST_HEADER } from '@/src/lib/tv-request'
import { CookieConsentProvider } from './provider'

// Server component: reads the consent cookie and the current session
// once, then hands them to the client provider. Kept as its own RSC so
// the cookies()/headers() calls land inside the layout's <Suspense>
// (Next's Cache Components warns when they run at the layout root).

export async function CookieConsentInit({ children }: { children: ReactNode }) {
  const requestHeaders = await headers()
  // Published customer sites have their own consent banner, and the public
  // TV pages run on a screen nobody clicks: Steel's banner, trackers and the
  // session lookup stay off there (both headers are set by proxy.ts).
  if (
    requestHeaders.get(SITE_REQUEST_HEADER) ||
    requestHeaders.get(TV_REQUEST_HEADER)
  ) {
    return (
      <CookieConsentProvider initial='rejected' isAuthenticated={false}>
        {children}
      </CookieConsentProvider>
    )
  }

  const [cookieStore, session] = await Promise.all([
    cookies(),
    auth.api.getSession({ headers: requestHeaders }),
  ])
  const initial = parseCookieConsent(cookieStore.get(COOKIE_NAME)?.value)

  return (
    <CookieConsentProvider
      initial={initial}
      isAuthenticated={!!session}
      userId={session?.user.id ?? null}
    >
      {children}
    </CookieConsentProvider>
  )
}
