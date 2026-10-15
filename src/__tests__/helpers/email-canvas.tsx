import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { getNode } from '@/src/lib/canvas/nodes'
import type {
  CanvasBreakpoint,
  CanvasDocument,
  CanvasNode,
} from '@/src/lib/canvas/types'
import { emailCatalog } from '@/src/lib/canvas-email/catalog'
import {
  BODY,
  COLUMN,
  defaultBodyProps,
  defaultColumnProps,
  defaultFooterProps,
  defaultSectionProps,
  FOOTER,
  SECTION,
} from '@/src/lib/canvas-email/components/layout'
import {
  createEmailRenderContext,
  type EmailRenderContext,
  EmailRenderProvider,
} from '@/src/lib/canvas-email/theme'

/** Test builders for e-mail canvas documents (catalog `email`, v2). */

export type BlockSpec = {
  type: string
  id?: string
  props?: Record<string, unknown>
  meta?: CanvasNode['meta']
}

/** A block node with the catalog's default props (+ overrides). */
export function emailBlock(spec: BlockSpec, index = 0): CanvasNode {
  const definition = emailCatalog.components[spec.type]
  if (!definition) throw new Error(`unknown type ${spec.type}`)
  return {
    id: spec.id ?? `b${index}`,
    type: spec.type,
    props: { ...definition.defaultProps(), ...spec.props },
    ...(spec.meta ? { meta: spec.meta } : {}),
  }
}

/**
 * A valid document: root → one section per entry of `columns` (each entry
 * is the list of columns, each column a list of blocks) → footer.
 */
export function emailDocument(
  sections: BlockSpec[][][] = [[[{ type: 'email.text' }]]],
  options: {
    root?: Record<string, unknown>
    section?: Record<string, unknown>
    column?: Record<string, unknown>
    footer?: Record<string, unknown>
  } = {},
): CanvasDocument {
  const nodes: Record<string, CanvasNode> = {}
  const rootChildren: string[] = []
  let count = 0
  sections.forEach((columns, s) => {
    const sectionId = `s${s}`
    const columnIds: string[] = []
    columns.forEach((blocks, c) => {
      const columnId = `s${s}c${c}`
      const ids: string[] = []
      for (const spec of blocks) {
        const node = emailBlock(spec, count++)
        nodes[node.id] = node
        ids.push(node.id)
      }
      nodes[columnId] = {
        id: columnId,
        type: COLUMN,
        props: { ...defaultColumnProps(), ...options.column },
        children: ids,
      }
      columnIds.push(columnId)
    })
    nodes[sectionId] = {
      id: sectionId,
      type: SECTION,
      props: { ...defaultSectionProps(), ...options.section },
      children: columnIds,
    }
    rootChildren.push(sectionId)
  })
  nodes.footer = {
    id: 'footer',
    type: FOOTER,
    props: { ...defaultFooterProps(), ...options.footer },
  }
  rootChildren.push('footer')
  nodes.root = {
    id: 'root',
    type: BODY,
    props: { ...defaultBodyProps(), ...options.root },
    children: rootChildren,
  }
  return { catalog: 'email', version: 2, rootId: 'root', nodes }
}

function EditingTree({
  doc,
  id,
  breakpoint,
}: {
  doc: CanvasDocument
  id: string
  breakpoint: CanvasBreakpoint
}): ReactNode {
  const node = getNode(doc, id)
  if (!node || node.meta?.hidden) return null
  const definition = emailCatalog.components[node.type]
  const children = node.children?.map((child) => (
    <EditingTree key={child} doc={doc} id={child} breakpoint={breakpoint} />
  ))
  return definition.render({
    node,
    children,
    breakpoint,
    editing: true,
    attributes: { 'data-canvas-id': id },
  })
}

/** Markup the editor canvas would show (editing mode, like the shell). */
export function renderEditing(
  doc: CanvasDocument,
  options: {
    breakpoint?: CanvasBreakpoint
    context?: Partial<Omit<EmailRenderContext, 'tokens'>>
  } = {},
): string {
  const ctx = createEmailRenderContext({
    lookup: (id) => getNode(doc, id),
    ...options.context,
  })
  const root = getNode(doc, doc.rootId) as CanvasNode
  return renderToStaticMarkup(
    <EmailRenderProvider value={ctx}>
      {emailCatalog.renderDocument({
        children: (
          <EditingTree
            doc={doc}
            id={doc.rootId}
            breakpoint={options.breakpoint ?? 'base'}
          />
        ),
        rootProps: root.props,
        editing: true,
      })}
    </EmailRenderProvider>,
  )
}
