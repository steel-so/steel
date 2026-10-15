import { GeistSans } from 'geist/font/sans'
import type { ReactNode } from 'react'

/**
 * Root layout of published sites — their own document, apart from Steel's
 * (no Steel styles, JSON-LD, trackers, cookie banner or theme script):
 * `lang="pt-BR"` and the Geist font the site theme offers. Each page adds
 * the site's own `<head>` (metadata, icon and the per-site CSP meta, see
 * `src/lib/sites/csp.ts`).
 *
 * No Suspense boundary on purpose: the page renders in full before the
 * response starts, so a missing page answers a real HTTP 404 (and a
 * redirect a real 307/308) instead of a streamed 200.
 */
export const instant = false

export default function SitesRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='pt-BR' className={GeistSans.variable}>
      <body>{children}</body>
    </html>
  )
}
