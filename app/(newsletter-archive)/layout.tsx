import { GeistSans } from 'geist/font/sans'
import '../globals.css'
import type { ReactNode } from 'react'
import { steelRootMetadata } from '@/app/_components/root/steel-root'
import { cn } from '@/lib/utils'
import '@/src/lib/zod-locale'

export const metadata = steelRootMetadata

/**
 * Root layout of the public newsletter archive (`/n/**`, ADR 0054). Its own
 * document, apart from `SteelRootLayout`: the archive is the customer's
 * brand and needs no Steel providers, trackers or cookie banner, and its
 * not-found page is the archive's own (pt-BR). The HTTP 404 status of an
 * unknown newsletter or issue is decided by the proxy before rendering
 * (`newsletterArchiveResponse`), as for the published sites.
 */
export const instant = false

export default function NewsletterArchiveLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <html
      lang='pt-BR'
      className={cn('scroll-smooth dark', GeistSans.variable)}
      suppressHydrationWarning
    >
      <head>
        {/* Theme before the first paint; a static file, since the
            prerendered shell does not get the CSP nonce. */}
        <script src='/theme-init.js' />
      </head>
      <body className='root bg-background text-foreground antialiased'>
        {children}
      </body>
    </html>
  )
}
