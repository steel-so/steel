import { GeistSans } from 'geist/font/sans'
import type { Metadata } from 'next'
import '../../globals.css'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { type ReactNode, Suspense } from 'react'
import { JsonLd } from '@/components/seo/json-ld'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
  siteJsonLd,
} from '@/src/lib/seo/site'
import { Providers } from '../providers'
import { CookieConsentBanner } from '../user/cookie-consent/banner'
import { ConsentedTrackers } from '../user/cookie-consent/consented-trackers'
import { CookieConsentInit } from '../user/cookie-consent/init'
import '@/src/lib/zod-locale'

/**
 * Root of every Steel screen (app, marketing, auth, onboarding). The app
 * has several root layouts — one per top-level group — so that published
 * customer sites (`app/(sites)`) get their own document without Steel's
 * styles, JSON-LD, trackers or cookie banner. Each Steel group's
 * `layout.tsx` renders `SteelRootLayout` and exports `steelRootMetadata`
 * (merged with its own). Navigating between two root layouts is a full
 * page load, which is what already happened between these groups in
 * practice (sign-in → app, site → app).
 */

export const steelRootMetadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    siteName: SITE_NAME,
    url: SITE_URL,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ['/twitter-image'],
  },
  alternates: {
    types: { 'application/rss+xml': '/changelog/rss.xml' },
  },
}

/** `steelRootMetadata` with a group's own fields on top. */
export function steelMetadata(own: Metadata = {}): Metadata {
  return { ...steelRootMetadata, ...own }
}

export function SteelRootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang='pt-BR'
      className={cn('scroll-smooth dark', GeistSans.variable)}
      suppressHydrationWarning
    >
      <head>
        {/* Tema antes da primeira pintura. Arquivo estático (não inline):
            a casca pré-renderizada não recebe o nonce da CSP. */}
        <script src='/theme-init.js' />
        <JsonLd data={siteJsonLd()} />
      </head>
      <body className='root antialiased bg-background text-primary h-screen'>
        <Suspense>
          <NuqsAdapter>
            <Providers>
              <CookieConsentInit>
                <TooltipProvider>
                  {children}
                  <Toaster />
                </TooltipProvider>
                <ConsentedTrackers />
                <CookieConsentBanner />
              </CookieConsentInit>
            </Providers>
          </NuqsAdapter>
        </Suspense>
      </body>
    </html>
  )
}
