import { GeistSans } from 'geist/font/sans'
import '../globals.css'
import type { ReactNode } from 'react'
import { steelRootMetadata } from '@/app/_components/root/steel-root'
import { cn } from '@/lib/utils'
import '@/src/lib/zod-locale'

export const metadata = steelRootMetadata

/**
 * Root layout of the public newsletter archive (`/n/**`, ADR 0054). Its own
 * document, apart from `SteelRootLayout`, so nothing wraps the pages in a
 * Suspense boundary: an unknown newsletter or issue calls `notFound()`
 * before the response starts streaming and answers a real HTTP 404 (same
 * approach as the published sites in `app/(sites)`). The archive needs no
 * Steel providers, trackers or cookie banner — it is the customer's brand.
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
