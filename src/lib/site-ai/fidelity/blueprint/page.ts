import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import { toDocument } from '@/src/lib/canvas-site/presets/builder'
import type { TextSlot } from '@/src/lib/site-ai/slots'
import type { FidelityPageResult } from './pipeline'

/**
 * Page document of a fidelity page. Drawn sections already carry their
 * final copy; only the ready sections (data sections and fallbacks) still
 * have sample copy that the copy call must write — `pickReadySlots` keeps
 * just their slots, so the model never rewrites a drawn section.
 */

export interface FidelityPageDocument {
  doc: CanvasDocument
  /** Ids of the top-level sections that are ready ones. */
  readySectionIds: Set<string>
}

export function fidelityPageDocument(
  page: Pick<FidelityPageResult, 'specs' | 'origins'>,
): FidelityPageDocument {
  const doc = toDocument(page.specs)
  const root = doc.nodes[doc.rootId]
  const readySectionIds = new Set<string>()
  for (const [index, id] of (root.children ?? []).entries()) {
    if (page.origins[index] === 'ready') readySectionIds.add(id)
  }
  return { doc, readySectionIds }
}

/** Top-level section of every node of the document. */
export function sectionOfNodes(doc: CanvasDocument): Map<string, string> {
  const owner = new Map<string, string>()
  const visit = (id: string, sectionId: string) => {
    owner.set(id, sectionId)
    const node: CanvasNode | undefined = doc.nodes[id]
    for (const child of node?.children ?? []) visit(child, sectionId)
  }
  for (const id of doc.nodes[doc.rootId].children ?? []) visit(id, id)
  return owner
}

/** The slots that belong to ready sections. */
export function pickReadySlots(
  page: FidelityPageDocument,
  slots: TextSlot[],
): TextSlot[] {
  const owner = sectionOfNodes(page.doc)
  return slots.filter((slot) => {
    const sectionId = owner.get(slot.nodeId)
    return sectionId !== undefined && page.readySectionIds.has(sectionId)
  })
}
