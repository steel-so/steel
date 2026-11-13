import { getNode } from '@/src/lib/canvas/nodes'
import type { CanvasDocument, CanvasNode } from './types'
import type { CanvasLink } from './values'

/**
 * Generic pre-publish checklist of a canvas document. Each catalog supplies
 * a pure `PublishChecker` (`(doc) => items`) and the shared `PublishChecklist`
 * UI renders the result: errors block publishing, warnings only recommend.
 */

export type PublishCheckLevel = 'error' | 'warning'

export type PublishCheckItem = {
  /** Stable machine code (`IMAGE_ALT_MISSING`). */
  code: string
  level: PublishCheckLevel
  /** pt-BR message for the editor. */
  message: string
  /** Node to select when the user clicks the item. */
  nodeId?: string
  /** Page or global the item belongs to (multi-document checks, sites). */
  documentId?: string
  /** Display name of that page or global. */
  documentName?: string
}

export type PublishChecker = (doc: CanvasDocument) => PublishCheckItem[]

export type PublishCheckSummary = {
  items: PublishCheckItem[]
  errors: PublishCheckItem[]
  warnings: PublishCheckItem[]
  /** At least one error: publishing must wait. */
  blocking: boolean
}

export function summarizePublishChecks(
  items: PublishCheckItem[],
): PublishCheckSummary {
  const errors = items.filter((item) => item.level === 'error')
  return {
    items,
    errors,
    warnings: items.filter((item) => item.level === 'warning'),
    blocking: errors.length > 0,
  }
}

/** Nodes reachable from the root that are not hidden (with their subtree). */
export function visiblePublishNodes(doc: CanvasDocument): CanvasNode[] {
  const nodes: CanvasNode[] = []
  // Stored documents may be malformed; validation reports that elsewhere.
  if (!doc || typeof doc.nodes !== 'object' || doc.nodes === null) return nodes
  const stack = [doc.rootId]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const id = stack.pop() as string
    if (seen.has(id)) continue
    seen.add(id)
    const node = getNode(doc, id)
    if (!node || node.meta?.hidden) continue
    nodes.push(node)
    for (const child of [...(node.children ?? [])].reverse()) stack.push(child)
  }
  return nodes
}

/** A text prop that is missing, not a string or only whitespace. */
export function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === ''
}

/** A link prop that points nowhere (absent or without a value). */
export function isBlankLink(link: CanvasLink | undefined | null): boolean {
  return !link || isBlank(link.value)
}
