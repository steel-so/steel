import { createId } from '@paralleldrive/cuid2'
import { getNode } from '@/src/lib/canvas/nodes'
import { cloneFragment } from '@/src/lib/canvas/ops'
import type {
  CanvasDocument,
  CanvasFragment,
  CanvasNodeId,
} from '@/src/lib/canvas/types'
import { SITE_SYMBOL_TYPE, SITE_TYPES } from '@/src/lib/canvas-site'
import { createEmptySiteDocument } from './document'

/**
 * Reusable components ("Componentes reutilizáveis"): a SYMBOL global keeps
 * the master document (a page root holding the section); pages hold
 * `site.symbol` instances pointing to it. Pure helpers for the editor and
 * the services.
 */

/** A section can become a reusable component (one selected section). */
export function symbolSourceOf(
  doc: CanvasDocument,
  selection: CanvasNodeId[],
): CanvasNodeId | null {
  if (selection.length !== 1) return null
  const node = getNode(doc, selection[0])
  return node?.type === SITE_TYPES.section ? node.id : null
}

/** Master document of a new symbol: a copy (fresh ids) of the subtree. */
export function symbolDocumentFrom(
  doc: CanvasDocument,
  nodeId: CanvasNodeId,
): CanvasDocument {
  const fragment = cloneFragment({ doc, id: nodeId })
  const base = createEmptySiteDocument()
  const root = getNode(base, base.rootId)
  return {
    ...base,
    nodes: {
      ...base.nodes,
      ...fragment.nodes,
      [base.rootId]: {
        ...root,
        id: base.rootId,
        type: SITE_TYPES.page,
        props: root?.props ?? {},
        children: [fragment.rootId],
      },
    },
  }
}

/** A lone instance of a symbol, to insert or drag into a page. */
export function symbolInstanceFragment(symbolId: string): CanvasFragment {
  const id = createId()
  return {
    rootId: id,
    nodes: {
      [id]: {
        id,
        type: SITE_SYMBOL_TYPE,
        props: { symbolId, overrides: {} },
      },
    },
  }
}

/** `true` when a document holds a reusable component instance (a master
 * cannot: a component inside another one). */
export function hasSymbolInstances(doc: CanvasDocument): boolean {
  return Object.values(doc.nodes).some((node) => node.type === SITE_SYMBOL_TYPE)
}

/** Plain text of a rich-text value (override fields). */
export function richTextToPlain(html: string): string {
  return html
    .replace(/<\/(p|li|h[1-6])>\s*/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Paragraphs (`<p>`) of plain text typed in an override field. */
export function plainToRichText(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('')
}
