import type { ReactNode } from 'react'
import type { CanvasDocument, CanvasNodeId } from '@/src/lib/canvas/types'
import { renderSiteNode, type SiteRenderContext } from './site-catalog-adapter'

/** Server-only walk of a published canvas document: no editor code, hidden
 * nodes dropped, every node rendered by the catalog with `editing: false`. */
function NodeTree({
  doc,
  id,
  ctx,
}: {
  doc: CanvasDocument
  id: CanvasNodeId
  ctx: SiteRenderContext
}): ReactNode {
  const node = Object.hasOwn(doc.nodes, id) ? doc.nodes[id] : undefined
  if (!node || node.meta?.hidden) return null
  const children = node.children?.length
    ? node.children.map((child) => (
        <NodeTree key={child} doc={doc} id={child} ctx={ctx} />
      ))
    : null
  return renderSiteNode(node, children, ctx)
}

export function SiteDocument({
  doc,
  ctx,
}: {
  doc: CanvasDocument
  ctx: SiteRenderContext
}) {
  return <NodeTree doc={doc} id={doc.rootId} ctx={ctx} />
}
