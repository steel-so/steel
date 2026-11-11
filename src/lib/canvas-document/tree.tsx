import type { ReactNode } from 'react'
import { getNode } from '@/src/lib/canvas/nodes'
import type { CanvasCatalog } from '@/src/lib/canvas/registry'
import type {
  CanvasDocument,
  CanvasNode,
  CanvasNodeId,
} from '@/src/lib/canvas/types'
import { DOCUMENT_SECTION_TYPE } from './constants'

/**
 * Final render of a document outside the editor (public link, print):
 * the catalog components with `editing: false` — no `data-canvas-id`, no
 * hints, hidden nodes dropped. Hook-free, so the print render can run it
 * through `renderToHtml` and the public link through React.
 */

function NodeTree({
  doc,
  id,
  catalog,
}: {
  doc: CanvasDocument
  id: CanvasNodeId
  catalog: CanvasCatalog
}): ReactNode {
  const node = getNode(doc, id)
  if (!node || node.meta?.hidden) return null
  const definition = Object.hasOwn(catalog.components, node.type)
    ? catalog.components[node.type]
    : undefined
  if (!definition) return null
  const children = node.children?.map((child) => (
    <NodeTree key={child} doc={doc} id={child} catalog={catalog} />
  ))
  return definition.render({
    node,
    children,
    breakpoint: 'base',
    editing: false,
  })
}

/** The document wrapped by the catalog's root (`.d-root`). */
export function DocumentTree({
  doc,
  catalog,
}: {
  doc: CanvasDocument
  catalog: CanvasCatalog
}): ReactNode {
  const root = getNode(doc, doc.rootId) as CanvasNode | undefined
  return catalog.renderDocument({
    children: <NodeTree doc={doc} id={doc.rootId} catalog={catalog} />,
    rootProps: root?.props ?? {},
    editing: false,
  })
}

/** The first visible section is a cover (printed edge to edge). */
export function isCoverFirst(doc: CanvasDocument): boolean {
  const root = getNode(doc, doc.rootId)
  for (const id of root?.children ?? []) {
    const node = getNode(doc, id)
    if (!node || node.meta?.hidden) continue
    if (node.type !== DOCUMENT_SECTION_TYPE) return false
    return node.props.variant === 'cover'
  }
  return false
}
