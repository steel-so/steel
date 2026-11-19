import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import {
  type NodeSpec,
  toDocument,
} from '@/src/lib/canvas-site/presets/builder'
import { validateSiteDocument } from '@/src/lib/sites/document'

/**
 * Swaps one top-level section of a page document for a freshly built one.
 * The builder numbers nodes `n0`, `n1`… in every fragment, so the new
 * nodes get a unique prefix before they join the document. The result is
 * validated by the site catalog; an invalid swap changes nothing.
 */

let swaps = 0

function collectIds(doc: CanvasDocument, id: string, out: string[]): void {
  out.push(id)
  for (const child of doc.nodes[id]?.children ?? []) collectIds(doc, child, out)
}

export type SwapResult =
  | {
      ok: true
      doc: CanvasDocument
      /** Puts the old section back into `current` (a later version of the
       * document: other sections may have changed since). */
      undo: (current: CanvasDocument) => CanvasDocument
    }
  | { ok: false; problems: string[] }

export function swapSection(
  doc: CanvasDocument,
  index: number,
  spec: NodeSpec,
): SwapResult {
  const root = doc.nodes[doc.rootId]
  const children = root?.children ?? []
  const oldId = children[index]
  if (oldId === undefined) {
    return { ok: false, problems: ['A seção não existe mais na página'] }
  }
  const fragment = toDocument([spec])
  const prefix = `rf${++swaps}x`
  const rename = (id: string) => `${prefix}${id}`
  const newTop = fragment.nodes[fragment.rootId].children?.[0]
  if (newTop === undefined) {
    return { ok: false, problems: ['A seção nova está vazia'] }
  }
  const nodes: Record<string, CanvasNode> = { ...doc.nodes }
  const removed: string[] = []
  collectIds(doc, oldId, removed)
  for (const id of removed) delete nodes[id]
  for (const [id, node] of Object.entries(fragment.nodes)) {
    if (id === fragment.rootId) continue
    nodes[rename(id)] = {
      ...node,
      id: rename(id),
      ...(node.children ? { children: node.children.map(rename) } : {}),
    }
  }
  const nextChildren = [...children]
  nextChildren[index] = rename(newTop)
  nodes[doc.rootId] = { ...root, children: nextChildren }
  const checked = validateSiteDocument({ ...doc, nodes })
  if (!checked.ok) return { ok: false, problems: checked.error }
  const oldNodes: Record<string, CanvasNode> = {}
  for (const id of removed) oldNodes[id] = doc.nodes[id]
  const newId = rename(newTop)
  const undo = (current: CanvasDocument): CanvasDocument => {
    const restored: Record<string, CanvasNode> = { ...current.nodes }
    const added: string[] = []
    if (current.nodes[newId]) collectIds(current, newId, added)
    for (const id of added) delete restored[id]
    Object.assign(restored, oldNodes)
    const currentRoot = current.nodes[current.rootId]
    const list = [...(currentRoot.children ?? [])]
    const position = list.indexOf(newId)
    if (position !== -1) list[position] = oldId
    restored[current.rootId] = { ...currentRoot, children: list }
    return { ...current, nodes: restored }
  }
  return { ok: true, doc: checked.value, undo }
}
