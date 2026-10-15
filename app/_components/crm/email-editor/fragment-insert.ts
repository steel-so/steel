import { findInsertLocation } from '@/app/_components/canvas/lib/drop-target'
import { getNode } from '@/src/lib/canvas/ops'
import type { CanvasStore } from '@/src/lib/canvas/store'
import type { CanvasFragment, CanvasLocation } from '@/src/lib/canvas/types'
import { FOOTER } from '@/src/lib/canvas-email/components/layout'

/**
 * Where a clicked (not dragged) fragment goes: the shell's rule (inside or
 * after the selection, else the end of the best container), but never
 * after the e-mail footer, which always closes the e-mail.
 */
export function fragmentLocation(
  store: CanvasStore,
  fragment: CanvasFragment,
): CanvasLocation | null {
  const { doc, selection } = store.getState()
  const type = fragment.nodes[fragment.rootId]?.type
  if (!type) return null
  const at = findInsertLocation(doc, store.catalog, type, selection[0] ?? null)
  if (!at || at.parentId !== doc.rootId) return at
  const children = getNode(doc, doc.rootId)?.children ?? []
  const footer = children.findIndex((id) => getNode(doc, id)?.type === FOOTER)
  return footer === -1 || at.index <= footer
    ? at
    : { parentId: at.parentId, index: footer }
}

/** Inserts a fragment by click; `false` when nothing in the e-mail takes it. */
export function insertFragmentByClick(
  store: CanvasStore,
  fragment: CanvasFragment,
): boolean {
  const at = fragmentLocation(store, fragment)
  if (!at) return false
  return store.insertFragment(fragment, at) !== null
}
