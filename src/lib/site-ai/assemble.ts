import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import type { CanvasLink } from '@/src/lib/canvas/values'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import { toDocument, toFragment } from '@/src/lib/canvas-site/presets/builder'
import { err, ok, type Result } from '@/src/lib/result'
import { validateSiteDocument } from '@/src/lib/sites/document'
import {
  buildFooter,
  buildHeader,
  buildSection,
  type SectionContext,
  type SiteAiSection,
} from './sections'

/**
 * Turns a plan into canvas documents: body sections into a page, header
 * and footer into globals, every link pointing somewhere real and every
 * document checked by the catalog before it is stored.
 */

/** Brand name the presets' sample copy uses. */
const SAMPLE_BRAND = /\bAurora\b/g

export function buildPageDocument(
  sections: SiteAiSection[],
  ctx: SectionContext,
): CanvasDocument {
  return toDocument(sections.map((type) => buildSection(type, ctx)))
}

/** A one-section fragment (editor "Gerar seção com IA"). */
export function buildSectionFragment(type: SiteAiSection, ctx: SectionContext) {
  return toFragment(buildSection(type, ctx))
}

export function buildGlobalDocuments(ctx: SectionContext, tagline: string) {
  // Globals render around the page's `<main>`, so their root is a `div`.
  return {
    header: toDocument([buildHeader(ctx)], { tag: 'div' }),
    footer: toDocument([buildFooter(ctx, tagline)], { tag: 'div' }),
  }
}

/** Anchors (`site.section` ids) defined in a tree. */
export function anchorsOf(nodes: Record<string, CanvasNode>): Set<string> {
  const anchors = new Set<string>()
  for (const node of Object.values(nodes)) {
    const anchor = node.props.anchor
    if (typeof anchor === 'string' && anchor) anchors.add(anchor)
  }
  return anchors
}

function isLink(value: unknown): value is CanvasLink {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as CanvasLink).type === 'string' &&
    typeof (value as CanvasLink).value === 'string'
  )
}

/**
 * Preset links point at anchors of a one-page site (`#contato`,
 * `#planos`…). Any anchor the tree does not define is sent to `fallback`
 * (the contact page or section), so a generated site has no dead links.
 * Mutates the nodes' props in place.
 */
export function fixLinks(
  nodes: Record<string, CanvasNode>,
  fallback: CanvasLink,
  anchors: Set<string> = anchorsOf(nodes),
): number {
  let fixed = 0
  const repair = (link: CanvasLink): CanvasLink => {
    if (link.type !== 'anchor') return link
    const target = link.value.replace(/^#/, '')
    if (anchors.has(target)) return link
    fixed++
    return { ...fallback }
  }
  for (const node of Object.values(nodes)) {
    const props = node.props
    if (isLink(props.link)) props.link = repair(props.link)
    for (const key of ['items', 'plans']) {
      const list = props[key]
      if (!Array.isArray(list)) continue
      props[key] = list.map((item) =>
        typeof item === 'object' && item !== null && isLink(item.link)
          ? { ...item, link: repair(item.link) }
          : item,
      )
    }
  }
  return fixed
}

/** Swaps the presets' sample brand for the company name in the copy the
 * model did not rewrite. Mutates in place. */
export function replaceSampleBrand(
  nodes: Record<string, CanvasNode>,
  company: string,
): void {
  const swap = (value: unknown) =>
    typeof value === 'string' ? value.replace(SAMPLE_BRAND, company) : value
  for (const node of Object.values(nodes)) {
    const props = node.props
    switch (node.type) {
      case SITE_TYPES.heading:
        props.text = swap(props.text)
        break
      case SITE_TYPES.text:
        props.html = swap(props.html)
        break
      case SITE_TYPES.button:
        props.label = swap(props.label)
        break
      default:
        break
    }
  }
}

/**
 * The document with only the sections that pass the catalog on their own
 * (a section that fails is dropped, never stored), then validated whole.
 */
export function keepValidSections(
  doc: CanvasDocument,
): Result<{ doc: CanvasDocument; dropped: string[] }, string[]> {
  const root = doc.nodes[doc.rootId]
  const dropped: string[] = []
  const kept: string[] = []
  for (const sectionId of root.children ?? []) {
    const single: CanvasDocument = {
      ...doc,
      nodes: { ...doc.nodes, [doc.rootId]: { ...root, children: [sectionId] } },
    }
    // Only the section's own subtree, so other sections' nodes do not count
    // as orphans.
    const subtree = collectSubtree(single, sectionId)
    const checked = validateSiteDocument({ ...single, nodes: subtree })
    if (checked.ok) kept.push(sectionId)
    else dropped.push(doc.nodes[sectionId]?.meta?.name ?? sectionId)
  }
  const nodes: Record<string, CanvasNode> = {
    [doc.rootId]: { ...root, children: kept },
  }
  for (const id of kept) {
    Object.assign(nodes, collectSubtree(doc, id, false))
  }
  const result = validateSiteDocument({ ...doc, nodes })
  if (!result.ok) return err(result.error)
  return ok({ doc: result.value, dropped })
}

function collectSubtree(
  doc: CanvasDocument,
  id: string,
  withRoot = true,
): Record<string, CanvasNode> {
  const out: Record<string, CanvasNode> = {}
  if (withRoot) out[doc.rootId] = doc.nodes[doc.rootId]
  const visit = (nodeId: string) => {
    const node = doc.nodes[nodeId]
    if (!node || out[nodeId]) return
    out[nodeId] = node
    for (const child of node.children ?? []) visit(child)
  }
  visit(id)
  return out
}
