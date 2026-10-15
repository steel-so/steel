import type * as Y from 'yjs'
import { getNode } from '@/src/lib/canvas/ops'
import type { CanvasCatalog } from '@/src/lib/canvas/registry'
import { allowsChild, definitionOf, propsIssues } from '@/src/lib/canvas/rules'
import type {
  CanvasDocument,
  CanvasNode,
  CanvasNodeId,
} from '@/src/lib/canvas/types'
import { nodesOf, type RawCanvas, readHeader, readYNode } from './ydoc'

export interface ProjectOptions {
  /** Validates each node (known type, props schema, accepted children,
   * `maxChildren`). Without it only the tree shape is repaired (server). */
  catalog?: CanvasCatalog
  /** Last good document: a node that fails validation keeps its version
   * from here instead of disappearing. */
  previous?: CanvasDocument
  /** Validity per node object, reused across projections. */
  validity?: WeakMap<CanvasNode, boolean>
}

export interface Projection {
  doc: CanvasDocument
  /** Nodes whose content was refused (invalid shape, type or props, or a
   * child the parent does not accept). */
  rejected: CanvasNodeId[]
}

function isValid(
  node: CanvasNode,
  catalog: CanvasCatalog,
  validity: WeakMap<CanvasNode, boolean>,
): boolean {
  const cached = validity.get(node)
  if (cached !== undefined) return cached
  const definition = definitionOf(catalog, node.type)
  const valid = !!definition && propsIssues(definition, node.props) === null
  validity.set(node, valid)
  return valid
}

/**
 * Turns the raw content of a Y document into a valid tree. Concurrent edits
 * can leave states no single op produces — a node moved into two parents at
 * once, a child id whose node was removed, a parent over its `maxChildren`
 * — and a client may send a malformed node. The projection is a
 * deterministic walk from the root (pre-order, first occurrence wins) that:
 *
 * - drops child ids that do not resolve or were already placed;
 * - with a catalog, refuses nodes of unknown types or with invalid props
 *   (falling back to `previous`, if it has the node) and children the
 *   parent does not accept or has no room for;
 * - leaves out nodes not reachable from the root.
 *
 * Returns `null` when the root itself is missing or invalid.
 */
export function projectCanvas(
  header: RawCanvas,
  /** Raw node by id: `undefined` when absent, `null` when malformed. */
  lookup: (id: CanvasNodeId) => CanvasNode | null | undefined,
  options: ProjectOptions = {},
): Projection | null {
  const { catalog, previous } = options
  const validity = options.validity ?? new WeakMap<CanvasNode, boolean>()
  const rejected: CanvasNodeId[] = []
  const nodes: Record<CanvasNodeId, CanvasNode> = {}
  const seen = new Set<CanvasNodeId>()

  /** The node to place under `id`: valid raw content, else the previous
   * version (a rejection), else nothing. */
  const resolve = (id: CanvasNodeId): CanvasNode | null => {
    const raw = lookup(id)
    if (raw === undefined) return null
    if (raw !== null && (!catalog || isValid(raw, catalog, validity))) {
      return raw
    }
    rejected.push(id)
    return (previous && getNode(previous, id)) ?? null
  }

  const visit = (node: CanvasNode): CanvasNode => {
    if (!node.children) return node
    const definition = catalog ? definitionOf(catalog, node.type) : undefined
    const kept: CanvasNodeId[] = []
    const pending: CanvasNode[] = []
    for (const childId of node.children) {
      if (seen.has(childId)) continue
      const child = resolve(childId)
      if (!child) continue
      if (definition && catalog) {
        const childDef = definitionOf(catalog, child.type)
        if (!childDef || !allowsChild(definition, childDef)) {
          rejected.push(childId)
          continue
        }
        if (
          definition.maxChildren !== undefined &&
          kept.length >= definition.maxChildren
        ) {
          rejected.push(childId)
          continue
        }
      }
      seen.add(childId)
      kept.push(childId)
      pending.push(child)
    }
    for (const child of pending) nodes[child.id] = visit(child)
    const same =
      kept.length === node.children.length &&
      kept.every((id, i) => id === node.children?.[i])
    return same ? node : { ...node, children: kept }
  }

  const root = resolve(header.rootId)
  if (!root) return null
  if (catalog && root.type !== catalog.rootType) return null
  seen.add(header.rootId)
  nodes[header.rootId] = visit(root)

  return {
    doc: {
      catalog: header.catalog,
      version: header.version,
      rootId: header.rootId,
      nodes,
    },
    rejected,
  }
}

/**
 * Projection of a whole Y document (server side, tests). `null` when the
 * document was never seeded or its root is unusable.
 */
export function readCanvas(
  ydoc: Y.Doc,
  options: ProjectOptions = {},
): Projection | null {
  const header = readHeader(ydoc)
  if (!header) return null
  const ynodes = nodesOf(ydoc)
  return projectCanvas(
    header,
    (id) => (ynodes.has(id) ? readYNode(id, ynodes.get(id)) : undefined),
    options,
  )
}

/** Same node objects under the same ids (the store can keep its document). */
export function sameNodes(a: CanvasDocument, b: CanvasDocument): boolean {
  if (a === b) return true
  const keys = Object.keys(b.nodes)
  if (keys.length !== Object.keys(a.nodes).length) return false
  return keys.every((id) => getNode(a, id) === getNode(b, id))
}
