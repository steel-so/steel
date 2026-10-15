import { GeistSans } from 'geist/font/sans'
import { headers } from 'next/headers'
import type { ReactNode } from 'react'
import { NODE_ENV } from '@/lib/env/env'
import { siteMetaCsp } from '@/src/lib/sites/csp'
import { loadPublishedSite } from '../../_lib/load'

/**
 * Root layout of published sites — their own document, apart from Steel's
 * (no Steel styles, JSON-LD, trackers, cookie banner or theme script):
 * `lang="pt-BR"`, the site's Content Security Policy first in `<head>`
 * (see `src/lib/sites/csp.ts`), and the Geist font the site theme offers.
 *
 * No Suspense boundary on purpose: the page renders in full before the
 * response starts, so a missing page answers a real HTTP 404 (and a
 * redirect a real 307/308) instead of a streamed 200.
 */
export const instant = false

export default async function SiteRootLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ siteSlug: string }>
}) {
  const { siteSlug } = await params
  const [site, requestHeaders] = await Promise.all([
    loadPublishedSite(siteSlug),
    headers(),
  ])
  const csp = siteMetaCsp(site?.snapshot.settings.tracking, {
    nonce: requestHeaders.get('x-nonce') ?? undefined,
    development: NODE_ENV === 'development',
  })
  return (
    <html lang='pt-BR' className={GeistSans.variable}>
      <head>
        <meta httpEquiv='Content-Security-Policy' content={csp} />
      </head>
      <body>{children}</body>
    </html>
  )
}
