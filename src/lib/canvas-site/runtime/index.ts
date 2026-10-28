import { getNode } from '@/src/lib/canvas/nodes'
import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import { SITE_FORM_SCRIPT } from '../components/form'
import { SITE_NEWSLETTER_SCRIPT } from '../components/newsletter'
import { SITE_TYPES } from '../constants'
import {
  SITE_ACTIONS_SCRIPT,
  SITE_BEFORE_AFTER_SCRIPT,
  SITE_BOOT_SCRIPT,
  SITE_CAROUSEL_SCRIPT,
  SITE_COUNTDOWN_SCRIPT,
  SITE_LIGHTBOX_SCRIPT,
  SITE_MAP_SCRIPT,
  SITE_REVEAL_SCRIPT,
  SITE_STATS_SCRIPT,
  SITE_TABS_SCRIPT,
} from './scripts'

export * from './scripts'

/**
 * Which runtime scripts a published page needs: only the features its
 * documents (page + header/footer globals) actually use, so a page without
 * carousels never ships the carousel code. The runtime inlines them with
 * the CSP nonce: `boot` at the start of the body (before the content, so
 * CSS can rely on `.s-js` without a flash), `scripts` at the end.
 */

export type SiteRuntimeFeature =
  | 'form'
  | 'carousel'
  | 'tabs'
  | 'actions'
  | 'lightbox'
  | 'countdown'
  | 'stats'
  | 'map'
  | 'before-after'
  | 'reveal'
  | 'newsletter'

export interface SiteRuntimeScript {
  id: SiteRuntimeFeature
  code: string
}

export interface SiteRuntime {
  /** Inline first (`null` when no script runs). */
  boot: string | null
  scripts: SiteRuntimeScript[]
}

const CODE: Record<SiteRuntimeFeature, string> = {
  form: SITE_FORM_SCRIPT,
  carousel: SITE_CAROUSEL_SCRIPT,
  tabs: SITE_TABS_SCRIPT,
  actions: SITE_ACTIONS_SCRIPT,
  lightbox: SITE_LIGHTBOX_SCRIPT,
  countdown: SITE_COUNTDOWN_SCRIPT,
  stats: SITE_STATS_SCRIPT,
  map: SITE_MAP_SCRIPT,
  'before-after': SITE_BEFORE_AFTER_SCRIPT,
  reveal: SITE_REVEAL_SCRIPT,
  newsletter: SITE_NEWSLETTER_SCRIPT,
}

/** Visible nodes of the documents (hidden subtrees skipped). */
function* visible(docs: CanvasDocument[]): Generator<CanvasNode> {
  for (const doc of docs) {
    const stack = [doc.rootId]
    while (stack.length > 0) {
      const node = getNode(doc, stack.pop() as string)
      if (!node || node.meta?.hidden) continue
      yield node
      stack.push(...(node.children ?? []))
    }
  }
}

/** The features a node needs. */
function featuresOf(node: CanvasNode): SiteRuntimeFeature[] {
  const p = node.props
  const out: SiteRuntimeFeature[] = []
  const action = (p.interaction as { action?: string } | undefined)?.action
  if (action && action !== 'none') out.push('actions')
  const animation = p.animation as
    | { effect?: string; trigger?: string }
    | undefined
  if (
    animation?.effect &&
    animation.effect !== 'none' &&
    (animation.trigger ?? 'scroll') === 'scroll'
  ) {
    out.push('reveal')
  }
  switch (node.type) {
    case SITE_TYPES.form:
      if (p.formToken) out.push('form')
      break
    case SITE_TYPES.carousel:
      out.push('carousel')
      break
    case SITE_TYPES.testimonials:
      if (p.layout === 'slider') out.push('carousel')
      break
    case SITE_TYPES.tabs:
      out.push('tabs')
      break
    case SITE_TYPES.popup:
      out.push('actions')
      break
    case SITE_TYPES.gallery:
      if (p.lightbox) out.push('lightbox')
      break
    case SITE_TYPES.countdown:
      out.push('countdown')
      break
    case SITE_TYPES.stats:
      if (p.animate) out.push('stats')
      break
    case SITE_TYPES.map:
      if (p.loadOnClick) out.push('map')
      break
    case SITE_TYPES.beforeAfter:
      out.push('before-after')
      break
    case SITE_TYPES.newsletterSubscribe:
      if (p.newsletterId) out.push('newsletter')
      break
  }
  return out
}

/** Features used by the documents, in a stable order. */
export function siteRuntimeFeatures(
  docs: CanvasDocument[],
): SiteRuntimeFeature[] {
  const used = new Set<SiteRuntimeFeature>()
  for (const node of visible(docs)) {
    for (const feature of featuresOf(node)) used.add(feature)
  }
  return (Object.keys(CODE) as SiteRuntimeFeature[]).filter((feature) =>
    used.has(feature),
  )
}

/** Boot snippet and scripts of a page (see the module comment). */
export function siteRuntimeScripts(docs: CanvasDocument[]): SiteRuntime {
  const scripts = siteRuntimeFeatures(docs).map((id) => ({
    id,
    code: CODE[id],
  }))
  return {
    boot: scripts.some(
      (script) => script.id !== 'form' && script.id !== 'newsletter',
    )
      ? SITE_BOOT_SCRIPT
      : null,
    scripts,
  }
}
