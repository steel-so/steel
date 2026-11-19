import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BETTER_AUTH_SECRET } from '@/lib/env/server'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  compileSiteCss,
  parseSiteTheme,
  SiteDocument,
  type SiteRenderContext,
} from '@/src/lib/canvas-site'
import { getQueueConnection } from '@/src/lib/queue/connection'
import { loadPreviewDraft } from '@/src/lib/site-ai/fidelity/refine/preview-store'
import { verifyPreviewToken } from '@/src/lib/site-ai/fidelity/refine/preview-token'
import { SITE_CHROME_CSS } from '../../_components/site-chrome-css'

/**
 * Preview of a site draft the AI is still refining (ADR 0072): the worker's
 * Chromium opens it to compare the draft with the references. The signed,
 * short-lived token in the URL is the only access; the draft lives in Redis
 * for a few minutes and is never indexed. `?p=<n>` picks the page. No
 * scripts run here: it only needs the markup and the compiled stylesheet.
 */

export const metadata: Metadata = {
  title: 'Prévia do rascunho',
  robots: { index: false, follow: false },
}

type PageProps = {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** Header/footer render their root as a `div`; only the page is `main`. */
function asChrome(doc: CanvasDocument | null): CanvasDocument | undefined {
  if (!doc) return undefined
  const root = doc.nodes[doc.rootId]
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [doc.rootId]: { ...root, props: { ...root.props, tag: 'div' } },
    },
  }
}

export default async function SitePreviewPage({
  params,
  searchParams,
}: PageProps) {
  const { token } = await params
  const id = verifyPreviewToken(BETTER_AUTH_SECRET, token)
  if (!id) notFound()
  const draft = await loadPreviewDraft(getQueueConnection(), id)
  if (!draft) notFound()
  const query = await searchParams
  const raw = Array.isArray(query.p) ? query.p[0] : query.p
  const index = Math.max(0, Number.parseInt(raw ?? '0', 10) || 0)
  const page = draft.pages[index]
  if (!page) notFound()

  const header = asChrome(draft.header)
  const footer = asChrome(draft.footer)
  const shown = [header, page.document, footer].filter(
    (doc): doc is CanvasDocument => doc !== undefined,
  )
  const context: SiteRenderContext = {
    pages: draft.pages.map((item, position) => ({
      id: String(position),
      title: item.title,
      path: '#',
    })),
    pageHref: () => '#',
  }
  const css = compileSiteCss(shown, { theme: parseSiteTheme(draft.theme) })
  return (
    <>
      <style>{css}</style>
      <style>{SITE_CHROME_CSS}</style>
      {header ? <SiteDocument doc={header} context={context} /> : null}
      <SiteDocument doc={page.document} context={context} />
      {footer ? <SiteDocument doc={footer} context={context} /> : null}
    </>
  )
}
