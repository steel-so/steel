'use client'

import { memo, useRef } from 'react'
import { childOnPath, getNode } from '@/src/lib/canvas/ops'
import type { CanvasNode, CanvasNodeId } from '@/src/lib/canvas/types'
import { useCanvasEditor } from '../editor-context'
import { shallowEqual, useCanvasNode, useCanvasStore } from '../use-canvas'

const NO_DEPS: readonly unknown[] = []
const NO_NODES: CanvasNode[] = []

/**
 * One document node rendered by its catalog component. Memoized per id: the
 * store keeps untouched nodes identical, so an edit re-renders only the
 * changed node (its parent renders the same children elements) — plus the
 * nodes whose definition `dependsOn` a value the edit changed.
 */
export const NodeView = memo(function NodeView({ id }: { id: CanvasNodeId }) {
  const node = useCanvasNode(id)
  const breakpoint = useCanvasStore((state) => state.breakpoint)
  const { catalog } = useCanvasEditor()
  // Re-render when what the definition reads from the rest of the document
  // changes (a sibling column's width, the body font), not only this node.
  useCanvasStore((state) => {
    const current = getNode(state.doc, id)
    const dependsOn = current && catalog.components[current.type]?.dependsOn
    return dependsOn ? dependsOn(state.doc, current) : NO_DEPS
  }, shallowEqual)
  // Carousels, tabs and popups show the child being edited: the one on the
  // path to the selection, or the last one that was (selecting the carousel
  // itself keeps the slide in view).
  const tracks = !!(node && catalog.components[node.type]?.tracksSelection)
  const onPath = useCanvasStore((state) =>
    tracks ? childOnPath(state.doc, id, state.selection[0]) : null,
  )
  const reads = !!(node && catalog.components[node.type]?.readsChildren)
  const childNodes = useCanvasStore((state) => {
    if (!reads) return NO_NODES
    const current = getNode(state.doc, id)
    return (current?.children ?? [])
      .map((child) => getNode(state.doc, child))
      .filter((child): child is CanvasNode => child !== undefined)
  }, shallowEqual)
  const lastActive = useRef<CanvasNodeId | null>(null)
  if (onPath) lastActive.current = onPath
  if (lastActive.current && !node?.children?.includes(lastActive.current)) {
    lastActive.current = null
  }
  if (!node || node.meta?.hidden) return null
  const attributes = { 'data-canvas-id': id }
  const definition = catalog.components[node.type]
  if (!definition) {
    return (
      <div
        {...attributes}
        style={{
          padding: 12,
          border: '1px dashed #dc2626',
          color: '#dc2626',
          font: '12px system-ui, sans-serif',
        }}
      >
        Componente indisponível ({node.type})
      </div>
    )
  }
  const children = node.children?.map((child) => (
    <NodeView key={child} id={child} />
  ))
  return (
    <>
      {definition.render({
        node,
        children,
        breakpoint,
        editing: true,
        attributes,
        ...(tracks ? { activeChild: lastActive.current } : {}),
        ...(reads ? { childNodes } : {}),
      })}
    </>
  )
})

/** The whole document wrapped by the catalog's `renderDocument`. */
export function DocumentView() {
  const { catalog } = useCanvasEditor()
  const rootId = useCanvasStore((state) => state.doc.rootId)
  const rootProps = useCanvasStore(
    (state) => getNode(state.doc, state.doc.rootId)?.props ?? {},
  )
  return (
    <>
      {catalog.renderDocument({
        children: <NodeView id={rootId} />,
        rootProps,
        editing: true,
      })}
    </>
  )
}
