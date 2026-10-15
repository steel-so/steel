/**
 * Content Security Policy of published sites. Two layers, both enforced
 * (the browser applies their intersection):
 *
 * 1. **Header** (`proxy.ts`, every `/s/<slug>` and site-host request): the
 *    widest policy any site may need — the runtime's own scripts by nonce
 *    plus the origins of the three supported trackers. None of Steel's own
 *    services (Axiom, Sentry, the wiki socket) is listed.
 * 2. **Per site** (`<meta http-equiv>` first in the page's `<head>`): the
 *    same policy keeping only the tracker origins this site configured, so
 *    a site without a Pixel can never load `connect.facebook.net`.
 *
 * Trackers are injected by the consent script after the visitor accepts
 * the site's cookie banner, carrying the page's nonce.
 */

export interface SiteTrackingIds {
  googleAnalyticsId?: string
  googleTagManagerId?: string
  metaPixelId?: string
}

/** Origins each tracker loads scripts from and sends data to. */
const TRACKER_ORIGINS = {
  google: {
    script: ['https://www.googletagmanager.com'],
    connect: [
      'https://www.googletagmanager.com',
      'https://*.google-analytics.com',
      'https://*.analytics.google.com',
    ],
  },
  meta: {
    script: ['https://connect.facebook.net'],
    connect: ['https://www.facebook.com', 'https://connect.facebook.net'],
  },
}

export function hasTrackers(tracking: SiteTrackingIds | undefined): boolean {
  return Boolean(
    tracking?.googleAnalyticsId ||
      tracking?.googleTagManagerId ||
      tracking?.metaPixelId,
  )
}

interface PolicyOptions {
  nonce?: string
  /** `true` everywhere but production builds (`next dev` needs eval). */
  development?: boolean
  /** Include the header-only directives (`frame-ancestors`). */
  header?: boolean
}

function buildPolicy(
  origins: { script: string[]; connect: string[] },
  options: PolicyOptions,
): string {
  const nonce = options.nonce ? ` 'nonce-${options.nonce}'` : ''
  const extra = (list: string[]) =>
    list.length ? ` ${[...new Set(list)].join(' ')}` : ''
  const directives = [
    "default-src 'self'",
    `script-src 'self'${nonce}${extra(origins.script)}${options.development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${extra(origins.connect)}`,
    // Videos (YouTube/Vimeo), GTM's noscript frame and the admin-only,
    // sandboxed `site.embed` (any https address).
    'frame-src https:',
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ]
  if (options.header) {
    directives.push("frame-ancestors 'self'", 'upgrade-insecure-requests')
  }
  return directives.join('; ')
}

/** Header CSP of every published-site request (all supported trackers). */
export function siteHeaderCsp(options: PolicyOptions): string {
  return buildPolicy(
    {
      script: [
        ...TRACKER_ORIGINS.google.script,
        ...TRACKER_ORIGINS.meta.script,
      ],
      connect: [
        ...TRACKER_ORIGINS.google.connect,
        ...TRACKER_ORIGINS.meta.connect,
      ],
    },
    { ...options, header: true },
  )
}

/** Per-site CSP (`<meta http-equiv>`): only the trackers it configured. */
export function siteMetaCsp(
  tracking: SiteTrackingIds | undefined,
  options: Omit<PolicyOptions, 'header'>,
): string {
  const google = Boolean(
    tracking?.googleAnalyticsId || tracking?.googleTagManagerId,
  )
  const meta = Boolean(tracking?.metaPixelId)
  return buildPolicy(
    {
      script: [
        ...(google ? TRACKER_ORIGINS.google.script : []),
        ...(meta ? TRACKER_ORIGINS.meta.script : []),
      ],
      connect: [
        ...(google ? TRACKER_ORIGINS.google.connect : []),
        ...(meta ? TRACKER_ORIGINS.meta.connect : []),
      ],
    },
    options,
  )
}
