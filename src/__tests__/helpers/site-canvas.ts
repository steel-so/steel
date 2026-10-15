import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { getNode } from '@/src/lib/canvas/nodes'
import type { CanvasCatalog } from '@/src/lib/canvas/registry'
import type { CanvasDocument, CanvasNodeId } from '@/src/lib/canvas/types'
import { createSiteCatalog } from '@/src/lib/canvas-site/catalog'
import type { SiteRenderContext } from '@/src/lib/canvas-site/context'
import {
  type NodeSpec,
  section,
  toDocument,
} from '@/src/lib/canvas-site/presets/builder'
import { SiteDocument } from '@/src/lib/canvas-site/render'

/** A page document with `nodes` inside one section. */
export function siteDoc(nodes: NodeSpec[]): CanvasDocument {
  return toDocument([section({}, nodes)])
}

/** Final HTML (public output) of a document. */
export function renderSite(
  doc: CanvasDocument,
  context: SiteRenderContext = {},
): string {
  return renderToStaticMarkup(createElement(SiteDocument, { doc, context }))
}

/** HTML the editor canvas renders (attributes + `editing: true`), like
 * the shell's NodeView. */
export function renderSiteEditing(
  doc: CanvasDocument,
  context: SiteRenderContext = {},
): string {
  const catalog = createSiteCatalog(context)
  const tree = (id: CanvasNodeId, cat: CanvasCatalog): ReactNode => {
    const node = getNode(doc, id)
    if (!node || node.meta?.hidden) return null
    const definition = cat.components[node.type]
    if (!definition) return null
    return definition.render({
      node,
      children: node.children?.map((child) =>
        createElement(Fragment, { key: child }, tree(child, cat)),
      ),
      breakpoint: 'base',
      editing: true,
      attributes: { 'data-canvas-id': id },
    })
  }
  const root = getNode(doc, doc.rootId)
  return renderToStaticMarkup(
    catalog.renderDocument({
      children: tree(doc.rootId, catalog),
      rootProps: root?.props ?? {},
      editing: true,
    }) as never,
  )
}

/** Id of the only node of `type` in the document. */
export function nodeOfType(doc: CanvasDocument, type: string) {
  const node = Object.values(doc.nodes).find((item) => item.type === type)
  if (!node) throw new Error(`no ${type}`)
  return node
}
