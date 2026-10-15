import { ImageResponse } from 'next/og'
import { parseSiteTheme } from '@/src/lib/canvas-site'
import { SITE_OG_IMAGE_SIZE } from '@/src/lib/sites/seo'
import { findSnapshotPage } from '@/src/lib/sites/snapshot'
import { loadPublishedSite } from '../../../_lib/load'

type Params = { params: Promise<{ siteSlug: string }> }

/**
 * Social card of a page without its own image (and of a site without a
 * default one): the page title over the site's theme colors, 1200×630.
 * `?page=<id>` picks the page; without it, the home page.
 */
export async function GET(request: Request, ctx: Params) {
  const { siteSlug } = await ctx.params
  const site = await loadPublishedSite(siteSlug)
  if (!site) return new Response('Not found', { status: 404 })

  const pageId = new URL(request.url).searchParams.get('page')
  const page =
    site.snapshot.pages.find((item) => item.id === pageId) ??
    findSnapshotPage(site.snapshot, [])
  if (!page) return new Response('Not found', { status: 404 })

  const { colors } = parseSiteTheme(site.snapshot.theme)
  const title = page.seo.title || page.title
  const description =
    page.seo.description || site.snapshot.settings.seo.description || ''
  const host = new URL(site.baseUrl).host

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px 80px',
        backgroundColor: colors.dark,
        color: colors.inverse,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            backgroundColor: colors.primary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 30,
            fontWeight: 700,
            color: '#fff',
          }}
        >
          {(site.snapshot.name.trim().charAt(0) || 'S').toUpperCase()}
        </div>
        <div style={{ fontSize: 30, fontWeight: 600, opacity: 0.9 }}>
          {site.snapshot.name}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div
          style={{
            fontSize: title.length > 48 ? 60 : 76,
            fontWeight: 700,
            lineHeight: 1.08,
            letterSpacing: -1.5,
          }}
        >
          {title.length > 110 ? `${title.slice(0, 107)}…` : title}
        </div>
        {description ? (
          <div style={{ fontSize: 30, lineHeight: 1.35, opacity: 0.75 }}>
            {description.length > 140
              ? `${description.slice(0, 137)}…`
              : description}
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div
          style={{
            width: 96,
            height: 6,
            borderRadius: 3,
            backgroundColor: colors.primary,
          }}
        />
        <div style={{ fontSize: 24, opacity: 0.7 }}>{host}</div>
      </div>
    </div>,
    {
      ...SITE_OG_IMAGE_SIZE,
      headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
    },
  )
}
