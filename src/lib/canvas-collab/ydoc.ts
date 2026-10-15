import * as Y from 'yjs'
import type { CanvasOp } from '@/src/lib/canvas/ops'
import { getNode, parentOf } from '@/src/lib/canvas/ops'
import { isNodeShape, isRecord } from '@/src/lib/canvas/rules'
import { collectSubtree } from '@/src/lib/canvas/tree'
import type {
  CanvasDocument,
  CanvasNode,
  CanvasNodeId,
} from '@/src/lib/canvas/types'

/**
 * Yjs layout of a normalized `CanvasDocument`:
 *
 * - `canvas.header` (top-level `Y.Map`): `catalog`, `version`, `rootId`.
 * - `canvas.nodes` (top-level `Y.Map`): node id → `Y.Map` with `type`
 *   (string), `props` (`Y.Map`), `children` (`Y.Array<string>`, only on
 *   nodes that can have children) and `meta` (`Y.Map`, optional).
 *
 * `props` and `meta` are flat maps keyed by leaf path (`toYProps`), so two
 * people editing different props of one node (`style.padding.top` and
 * `style.color`) both keep their change. Arrays and primitives are leaf
 * values (last writer wins), which is what a list of items or a rich-text
 * string needs.
 *
 * Top-level types are used (not a map inside a map) because concurrent
 * creation of a nested shared type would let one client's copy win.
 */
export const HEADER_KEY = 'canvas.header'
export const NODES_KEY = 'canvas.nodes'

export type YNode = Y.Map<unknown>

export function headerOf(ydoc: Y.Doc): Y.Map<unknown> {
  return ydoc.getMap(HEADER_KEY)
}

export function nodesOf(ydoc: Y.Doc): Y.Map<YNode> {
  return ydoc.getMap<YNode>(NODES_KEY)
}

/** The Y document holds a canvas document (it was seeded). */
export function hasCanvas(ydoc: Y.Doc): boolean {
  return typeof headerOf(ydoc).get('rootId') === 'string'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** Structural equality of JSON-like values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const other = b as unknown[]
    return (
      a.length === other.length &&
      a.every((item, i) => deepEqual(item, other[i]))
    )
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left).filter((key) => left[key] !== undefined)
  const otherKeys = Object.keys(right).filter((key) => right[key] !== undefined)
  return (
    keys.length === otherKeys.length &&
    keys.every(
      (key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]),
    )
  )
}

/** JSON-safe copy of a leaf value. */
function leaf(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}

/** Separator of path segments in a flattened key (never in prop names). */
export const PATH_SEP = '\u001f'

const nonEmptyObject = (value: unknown): value is Record<string, unknown> =>
  isPlainObject(value) && Object.keys(value).length > 0

function join(prefix: string, key: string): string {
  return prefix ? `${prefix}${PATH_SEP}${key}` : key
}

/** `[path, leaf]` pairs of an object: nested non-empty objects are walked,
 * anything else (primitives, arrays, `{}`) is a leaf. */
export function flatten(
  value: Record<string, unknown>,
  prefix = '',
  out: Array<[string, unknown]> = [],
): Array<[string, unknown]> {
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue
    const path = join(prefix, key)
    if (nonEmptyObject(item)) flatten(item, path, out)
    else out.push([path, item])
  }
  return out
}

/** Inverse of `flatten`. Deeper paths win over a shallower leaf at the
 * same place (two people turned one value into different shapes). */
export function unflatten(
  entries: Record<string, unknown>,
): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  const keys = Object.keys(entries).sort(
    (a, b) =>
      a.split(PATH_SEP).length - b.split(PATH_SEP).length || (a < b ? -1 : 1),
  )
  for (const key of keys) {
    const segments = key.split(PATH_SEP)
    let target = root
    for (const segment of segments.slice(0, -1)) {
      const next = target[segment]
      if (isPlainObject(next)) {
        target = next
      } else {
        const created: Record<string, unknown> = {}
        target[segment] = created
        target = created
      }
    }
    const last = segments[segments.length - 1]
    const value = entries[key]
    if (isPlainObject(target[last]) && isPlainObject(value)) continue
    target[last] = isPlainObject(value) ? { ...value } : value
  }
  return root
}

/**
 * A flat `Y.Map` of an object: one key per leaf path (`style␟padding␟top`).
 * Flat rather than nested maps, so two people creating different paths
 * under an object that did not exist yet both keep their value (nested
 * maps created concurrently would replace each other).
 */
export function toYProps(value: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>()
  for (const [path, item] of flatten(value)) map.set(path, leaf(item))
  return map
}

export function readYProps(map: Y.Map<unknown>): Record<string, unknown> {
  return unflatten(map.toJSON())
}

/** Deletes `path` and every path under it. */
function deleteUnder(map: Y.Map<unknown>, path: string): void {
  const prefix = `${path}${PATH_SEP}`
  for (const key of [...map.keys()]) {
    if (key === path || key.startsWith(prefix)) map.delete(key)
  }
}

/**
 * Writes the difference between `prev` and `next` into a flat props map.
 * Keys whose value is the same object in both (structural sharing) are
 * skipped without a comparison, and a key equal in both keeps whatever Y
 * holds now — possibly someone else's newer value. So an edit only writes
 * the paths it changed.
 */
export function syncProps(
  map: Y.Map<unknown>,
  prev: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
  prefix = '',
): void {
  if (prev) {
    for (const key of Object.keys(prev)) {
      if (prev[key] !== undefined && next[key] === undefined) {
        deleteUnder(map, join(prefix, key))
      }
    }
  }
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue
    const before = prev?.[key]
    if (before === value) continue
    const path = join(prefix, key)
    if (nonEmptyObject(value)) {
      if (nonEmptyObject(before)) {
        syncProps(map, before, value, path)
      } else {
        if (map.has(path)) map.delete(path)
        for (const [sub, item] of flatten(value, path)) map.set(sub, leaf(item))
      }
    } else if (!deepEqual(before, value)) {
      if (nonEmptyObject(before)) deleteUnder(map, path)
      map.set(path, leaf(value))
    }
  }
}

/** Rewrites a `Y.Array` of ids into `next` with one delete and one insert
 * over the part that differs (common prefix and suffix are kept). */
export function syncIds(array: Y.Array<string>, next: CanvasNodeId[]): void {
  const current = array.toArray()
  let start = 0
  while (
    start < current.length &&
    start < next.length &&
    current[start] === next[start]
  ) {
    start++
  }
  let end = 0
  while (
    end < current.length - start &&
    end < next.length - start &&
    current[current.length - 1 - end] === next[next.length - 1 - end]
  ) {
    end++
  }
  const removed = current.length - start - end
  if (removed > 0) array.delete(start, removed)
  const inserted = next.slice(start, next.length - end)
  if (inserted.length > 0) array.insert(start, inserted)
}

function createYNode(node: CanvasNode): YNode {
  const ynode = new Y.Map<unknown>()
  ynode.set('type', node.type)
  ynode.set('props', toYProps(node.props))
  if (node.children) ynode.set('children', Y.Array.from([...node.children]))
  if (node.meta) ynode.set('meta', toYProps(node.meta))
  return ynode
}

/** Plain node from its `Y.Map`, or `null` when the shape is broken. */
export function readYNode(id: CanvasNodeId, ynode: unknown): CanvasNode | null {
  if (!(ynode instanceof Y.Map)) return null
  const props = ynode.get('props')
  const children = ynode.get('children')
  const meta = ynode.get('meta')
  const node: Record<string, unknown> = {
    id,
    type: ynode.get('type'),
    props: props instanceof Y.Map ? readYProps(props) : props,
  }
  if (children !== undefined) {
    node.children = children instanceof Y.Array ? children.toArray() : children
  }
  if (meta !== undefined) {
    node.meta = meta instanceof Y.Map ? readYProps(meta) : meta
  }
  return isNodeShape(node, id) ? node : null
}

/**
 * Brings the node `id` in Y from `prev` to `next` (`undefined` = absent).
 * Without `prev` the current Y content is the baseline, so only what really
 * differs is written.
 */
export function writeNode(
  nodes: Y.Map<YNode>,
  id: CanvasNodeId,
  prev: CanvasNode | undefined,
  next: CanvasNode | undefined,
): void {
  if (!next) {
    if (nodes.has(id)) nodes.delete(id)
    return
  }
  const ynode = nodes.get(id)
  if (!(ynode instanceof Y.Map)) {
    nodes.set(id, createYNode(next))
    return
  }
  const before = prev ?? readYNode(id, ynode) ?? undefined
  if (ynode.get('type') !== next.type) ynode.set('type', next.type)

  const props = ynode.get('props')
  if (props instanceof Y.Map) {
    if (before?.props !== next.props)
      syncProps(props, before?.props, next.props)
  } else {
    ynode.set('props', toYProps(next.props))
  }

  if (next.children) {
    const children = ynode.get('children')
    if (children instanceof Y.Array) {
      if (before?.children !== next.children) {
        syncIds(children as Y.Array<string>, next.children)
      }
    } else {
      ynode.set('children', Y.Array.from([...next.children]))
    }
  } else if (ynode.has('children')) {
    ynode.delete('children')
  }

  if (next.meta) {
    const meta = ynode.get('meta')
    if (meta instanceof Y.Map) {
      if (before?.meta !== next.meta) syncProps(meta, before?.meta, next.meta)
    } else {
      ynode.set('meta', toYProps(next.meta))
    }
  } else if (ynode.has('meta')) {
    ynode.delete('meta')
  }
}

/** Writes a whole document into an empty Y document. */
export function seedYDoc(
  ydoc: Y.Doc,
  doc: CanvasDocument,
  origin: unknown = null,
): void {
  ydoc.transact(() => {
    const header = headerOf(ydoc)
    header.set('catalog', doc.catalog)
    header.set('version', doc.version)
    header.set('rootId', doc.rootId)
    const nodes = nodesOf(ydoc)
    for (const [id, node] of Object.entries(doc.nodes)) {
      writeNode(nodes, id, undefined, node)
    }
  }, origin)
}

/** Ids an op may have changed in `prev → next` (parents included). */
export function touchedIds(
  op: CanvasOp,
  prev: CanvasDocument,
  next: CanvasDocument,
  out: Set<CanvasNodeId> = new Set(),
): Set<CanvasNodeId> {
  const addParents = (id: CanvasNodeId) => {
    const before = parentOf(prev, id)
    const after = parentOf(next, id)
    if (before) out.add(before)
    if (after) out.add(after)
  }
  switch (op.kind) {
    case 'insert':
      out.add(op.at.parentId)
      for (const id of Object.keys(op.fragment.nodes ?? {})) out.add(id)
      break
    case 'remove':
      addParents(op.id)
      for (const id of collectSubtree(
        (nodeId) => getNode(prev, nodeId),
        op.id,
      )) {
        out.add(id)
      }
      break
    case 'move':
      out.add(op.id)
      out.add(op.to.parentId)
      addParents(op.id)
      break
    case 'update':
    case 'meta':
      out.add(op.id)
      break
    case 'batch':
      for (const child of op.ops) touchedIds(child, prev, next, out)
      break
  }
  return out
}

/** Every id of either document (resets and reconciliation). */
export function allIds(...docs: CanvasDocument[]): Set<CanvasNodeId> {
  const out = new Set<CanvasNodeId>()
  for (const doc of docs) for (const id of Object.keys(doc.nodes)) out.add(id)
  return out
}

/**
 * Writes `prev → next` for the given ids in one transaction. Nodes that are
 * the same object in both documents are skipped.
 */
export function writeChange(
  ydoc: Y.Doc,
  prev: CanvasDocument,
  next: CanvasDocument,
  ids: Iterable<CanvasNodeId>,
  origin: unknown,
): void {
  ydoc.transact(() => {
    const nodes = nodesOf(ydoc)
    for (const id of ids) {
      const before = getNode(prev, id)
      const after = getNode(next, id)
      if (before === after) continue
      writeNode(nodes, id, before, after)
    }
  }, origin)
}

/**
 * Three-way merge at node level: writes into Y only what changed between
 * `base` and `external` (an edit made outside the realtime session, such as
 * a REST save or a version restore), leaving everything else as it is in Y.
 */
export function mergeExternal(
  ydoc: Y.Doc,
  base: CanvasDocument,
  external: CanvasDocument,
  origin: unknown,
): number {
  let changed = 0
  ydoc.transact(() => {
    const nodes = nodesOf(ydoc)
    for (const id of allIds(base, external)) {
      const before = getNode(base, id)
      const after = getNode(external, id)
      if (deepEqual(before, after)) continue
      changed++
      writeNode(nodes, id, before, after)
    }
  }, origin)
  return changed
}

export interface RawCanvas {
  catalog: string
  version: number
  rootId: CanvasNodeId
}

export function readHeader(ydoc: Y.Doc): RawCanvas | null {
  const header = headerOf(ydoc)
  const catalog = header.get('catalog')
  const version = header.get('version')
  const rootId = header.get('rootId')
  if (
    typeof catalog !== 'string' ||
    typeof version !== 'number' ||
    typeof rootId !== 'string'
  ) {
    return null
  }
  return { catalog, version, rootId }
}
