import { GeistSans } from 'geist/font/sans'
import type { ReactNode } from 'react'

/**
 * Root layout of published sites — their own document, apart from Steel's
 * (no Steel styles, JSON-LD, trackers, cookie banner or theme script):
 * `lang="pt-BR"` and the Geist font the site theme offers. Each page adds
 * the site's own `<head>` (metadata, icon and the per-site CSP meta, see
 * `src/lib/sites/csp.ts`).
 *
 * HTTP statuses (404, 301/302) are decided by the proxy from the site's
 * route index before rendering (`src/lib/sites/route-index.ts`).
 */
export const instant = false

export default function SitesRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='pt-BR' className={GeistSans.variable}>
      <body>{children}</body>
    </html>
  )
}
