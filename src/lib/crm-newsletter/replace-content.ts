import { type CanvasOp, cloneFragment } from '@/src/lib/canvas/ops'
import type { CanvasDocument, CanvasFragment } from '@/src/lib/canvas/types'
import { FOOTER } from '@/src/lib/canvas-email/components/layout'

/**
 * One undoable batch that swaps the content of an e-mail document for the
 * sections "Escrever com IA" returned (newsletter2 nl2-digest-ai): every
 * child of the body except the footer goes, the sections come in before
 * the footer with fresh ids. `null` when there is nothing to insert.
 */
export function replaceContentOp(
  doc: CanvasDocument,
  sections: CanvasFragment[],
): CanvasOp | null {
  if (sections.length === 0) return null
  const root = doc.nodes[doc.rootId]
  const children = root?.children ?? []
  const removes: CanvasOp[] = children
    .filter((id) => doc.nodes[id]?.type !== FOOTER)
    .map((id) => ({ kind: 'remove', id }))
  const inserts: CanvasOp[] = sections.map((fragment, index) => ({
    kind: 'insert',
    fragment: cloneFragment(fragment),
    at: { parentId: doc.rootId, index },
  }))
  return {
    kind: 'batch',
    label: 'Edição escrita pela IA',
    ops: [...removes, ...inserts],
  }
}
