import type { ReactNode } from 'react'
import { getNode } from '@/src/lib/canvas/nodes'
import type { CanvasCatalog } from '@/src/lib/canvas/registry'
import type {
  CanvasDocument,
  CanvasNode,
  CanvasNodeId,
} from '@/src/lib/canvas/types'
import { createSiteCatalog } from './catalog'
import { SITE_TYPES } from './constants'
import type { SiteRenderContext } from './context'

/**
 * Final render of site documents (public runtime, previews, tests): the
 * same components as the editor with `editing: false` — no
 * `data-canvas-id`, no hints, hidden nodes dropped. Pure React with no
 * hooks or client code, so it renders in a Server Component; pair it with
 * `compileSiteCss` for the stylesheet.
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
    childNodes: definition.readsChildren
      ? (node.children ?? [])
          .map((child) => getNode(doc, child))
          .filter((child): child is CanvasNode => child !== undefined)
      : undefined,
  })
}

/** A validated site document as React elements, wrapped in `.s-site`. */
export function SiteDocument({
  doc,
  context = {},
  catalog = createSiteCatalog(context),
}: {
  doc: CanvasDocument
  context?: SiteRenderContext
  /** Reuse one catalog across documents of the same render. */
  catalog?: CanvasCatalog
}): ReactNode {
  const root = getNode(doc, doc.rootId) as CanvasNode
  return catalog.renderDocument({
    children: <NodeTree doc={doc} id={doc.rootId} catalog={catalog} />,
    rootProps: root.props,
    editing: false,
  })
}

/** Types present (and not hidden) in the documents. */
export function documentTypes(docs: CanvasDocument[]): Set<string> {
  const types = new Set<string>()
  for (const doc of docs) {
    const stack = [doc.rootId]
    while (stack.length > 0) {
      const node = getNode(doc, stack.pop() as string)
      if (!node || node.meta?.hidden) continue
      types.add(node.type)
      stack.push(...(node.children ?? []))
    }
  }
  return types
}

/** The page needs `SITE_FORM_SCRIPT` (it shows a CRM form). */
export function needsFormScript(docs: CanvasDocument[]): boolean {
  return documentTypes(docs).has(SITE_TYPES.form)
}
