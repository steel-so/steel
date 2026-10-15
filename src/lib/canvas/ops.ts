import { createId } from '@paralleldrive/cuid2'
import { err, ok, type Result } from '@/src/lib/result'
import { DocDraft } from './draft'
import { getNode } from './nodes'
import { parsePath, restoreEntry, setIn } from './path'
import type { CanvasCatalog } from './registry'
import {
  definitionOf,
  isNodeShape,
  isRecord,
  nodeIssues,
  placementError,
  propsIssues,
} from './rules'
import { collectSubtree, lookupParent } from './tree'
import {
  type CanvasDocument,
  type CanvasFragment,
  type CanvasLocation,
  type CanvasNode,
  type CanvasNodeId,
  ROOT_ID,
} from './types'

export { getNode } from './nodes'
export { resolveResponsive } from './responsive'
export { parentOf } from './tree'

/**
 * Every change to a document is one of these operations. They are pure:
 * `applyOp` returns a new document (structural sharing — untouched nodes keep
 * their identity, so React memo works) and the inverse op for undo.
 */
export type CanvasOp =
  /** Insert a fragment's `rootId` subtree; its ids must not exist in the
   * document yet (use `cloneFragment` for fresh ids). */
  | { kind: 'insert'; fragment: CanvasFragment; at: CanvasLocation }
  /** Remove a node and its subtree. The inverse is an insert of that subtree. */
  | { kind: 'remove'; id: CanvasNodeId }
  /** `to.index` is an insertion point in the target's children *as they are
   * now* (a drop line between siblings): within the same parent, dropping
   * after the node's own slot accounts for that slot. */
  | { kind: 'move'; id: CanvasNodeId; to: CanvasLocation }
  /** Set props by dot path (`style.padding.top`). `undefined` deletes the key. */
  | { kind: 'update'; id: CanvasNodeId; set: Record<string, unknown> }
  | {
      kind: 'meta'
      id: CanvasNodeId
      /** `undefined` removes a key; an emptied `meta` is dropped. */
      set: Partial<NonNullable<CanvasNode['meta']>>
    }
  /** Several ops applied (and undone) as one step; all or nothing. */
  | { kind: 'batch'; ops: CanvasOp[]; label?: string }

/** Why an op was refused — shown to the user in pt-BR by the shell. */
export type CanvasOpError =
  | { code: 'NODE_NOT_FOUND'; id: CanvasNodeId }
  | { code: 'NOT_ACCEPTED'; parentType: string; childType: string }
  | { code: 'MAX_CHILDREN'; parentType: string; max: number }
  | { code: 'MIN_CHILDREN'; parentType: string; min: number }
  | { code: 'REQUIRED'; type: string }
  | { code: 'UNIQUE'; type: string }
  | { code: 'CYCLE'; id: CanvasNodeId }
  | { code: 'ROOT'; op: CanvasOp['kind'] }
  | { code: 'LOCKED'; id: CanvasNodeId }
  | { code: 'INVALID_PROPS'; id: CanvasNodeId; issues: string[] }
  /** A type the catalog does not register. */
  | { code: 'UNKNOWN_TYPE'; type: string }
  /** An inserted id already exists in the document. */
  | { code: 'DUPLICATE_ID'; id: CanvasNodeId }
  /** Malformed document or fragment (shape, catalog/version, orphans). */
  | { code: 'INVALID_DOCUMENT'; reason: string }

export interface AppliedOp {
  doc: CanvasDocument
  inverse: CanvasOp
}

export interface ApplyOptions {
  /**
   * The op replays history (undo/redo): skip the user-intent guards the
   * original op already passed — `LOCKED` (the node may have been locked
   * since) and `REQUIRED` (undoing the insert of a required node). Structural
   * rules still apply.
   */
  replay?: boolean
}

interface Context {
  draft: DocDraft
  catalog: CanvasCatalog
  replay: boolean
}

type OpResult = Result<CanvasOp, CanvasOpError>

/**
 * Validates against the catalog (accepts/parents/max/min/required/unique/
 * locked/props schema, cycle and root guards) and applies. Never throws. A
 * refused op leaves the document untouched (a batch is all or nothing). An op
 * that changes nothing returns the same document object.
 *
 * Cost: O(depth + size of what the op touches), plus one shallow copy of the
 * `nodes` record per call (a flat key copy, not per-node work). Inserting a
 * `unique` type also scans the document once.
 */
export function applyOp(
  doc: CanvasDocument,
  op: CanvasOp,
  catalog: CanvasCatalog,
  options: ApplyOptions = {},
): Result<AppliedOp, CanvasOpError> {
  const ctx: Context = {
    draft: new DocDraft(doc),
    catalog,
    replay: options.replay === true,
  }
  const result = run(ctx, op)
  if (!result.ok) return result
  return ok({ doc: ctx.draft.commit(), inverse: result.value })
}

function run(ctx: Context, op: CanvasOp): OpResult {
  switch (op.kind) {
    case 'insert':
      return insert(ctx, op)
    case 'remove':
      return remove(ctx, op)
    case 'move':
      return move(ctx, op)
    case 'update':
      return update(ctx, op)
    case 'meta':
      return meta(ctx, op)
    case 'batch':
      return batch(ctx, op)
  }
}

/** Clamps an index to `[0, length]`; non-numbers mean "at the end". */
function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length
  return Math.min(Math.max(Math.trunc(index), 0), length)
}

function notFound(id: CanvasNodeId): Result<never, CanvasOpError> {
  return err({ code: 'NODE_NOT_FOUND', id })
}

// ─── insert ───────────────────────────────────────────────────────────────

/**
 * Walks a fragment from `rootId` checking shape, ids and per-node rules.
 * Returns the ids in pre-order.
 */
function checkFragment(
  ctx: Context,
  fragment: CanvasFragment,
): Result<CanvasNodeId[], CanvasOpError> {
  const nodes = isRecord(fragment.nodes) ? fragment.nodes : {}
  const lookup = (id: CanvasNodeId) =>
    Object.hasOwn(nodes, id) ? nodes[id] : undefined
  const order: CanvasNodeId[] = []
  const seen = new Set<CanvasNodeId>()
  const stack = [fragment.rootId]
  while (stack.length > 0) {
    const id = stack.pop() as CanvasNodeId
    const node = lookup(id)
    if (!node) return notFound(id)
    if (seen.has(id)) return err({ code: 'CYCLE', id })
    if (!isNodeShape(node, id)) {
      return err({ code: 'INVALID_DOCUMENT', reason: `malformed node ${id}` })
    }
    if (ctx.draft.get(id)) return err({ code: 'DUPLICATE_ID', id })
    seen.add(id)
    order.push(id)
    const children = node.children ?? []
    for (const child of children) {
      if (!lookup(child)) return notFound(child)
    }
    for (const issue of nodeIssues(ctx.catalog, node, lookup)) {
      return err(issue)
    }
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
  }
  return ok(order)
}

/** A `unique` type may appear once in the whole document. */
function uniqueError(ctx: Context, types: string[]): CanvasOpError | null {
  const unique = types.filter(
    (type) => definitionOf(ctx.catalog, type)?.unique === true,
  )
  if (unique.length === 0) return null
  const counts = new Map<string, number>()
  for (const type of unique) counts.set(type, (counts.get(type) ?? 0) + 1)
  for (const node of ctx.draft.values()) {
    const count = counts.get(node.type)
    if (count !== undefined) counts.set(node.type, count + 1)
  }
  for (const [type, count] of counts) {
    if (count > 1) return { code: 'UNIQUE', type }
  }
  return null
}

function maxError(ctx: Context, parent: CanvasNode): CanvasOpError | null {
  const max = definitionOf(ctx.catalog, parent.type)?.maxChildren
  if (max !== undefined && (parent.children ?? []).length + 1 > max) {
    return { code: 'MAX_CHILDREN', parentType: parent.type, max }
  }
  return null
}

/** `parent` is about to lose one of its (existing) children. */
function minError(ctx: Context, parent: CanvasNode): CanvasOpError | null {
  const min = definitionOf(ctx.catalog, parent.type)?.minChildren
  if (
    min !== undefined &&
    (parent.children as CanvasNodeId[]).length - 1 < min
  ) {
    return { code: 'MIN_CHILDREN', parentType: parent.type, min }
  }
  return null
}

function insert(
  ctx: Context,
  op: Extract<CanvasOp, { kind: 'insert' }>,
): OpResult {
  const { draft } = ctx
  const { fragment, at } = op
  const parent = draft.get(at.parentId)
  if (!parent) return notFound(at.parentId)

  const checked = checkFragment(ctx, fragment)
  if (!checked.ok) return checked
  const ids = checked.value
  const root = fragment.nodes[fragment.rootId]

  const refused =
    placementError(ctx.catalog, parent, root.type) ??
    maxError(ctx, parent) ??
    uniqueError(
      ctx,
      ids.map((id) => fragment.nodes[id].type),
    )
  if (refused) return err(refused)

  const siblings = parent.children ?? []
  const index = clampIndex(at.index, siblings.length)
  const children = siblings.slice()
  children.splice(index, 0, root.id)
  draft.patch(parent.id, { children })
  draft.put(root, parent.id)
  for (const id of ids) {
    for (const child of fragment.nodes[id].children ?? []) {
      draft.put(fragment.nodes[child], id)
    }
  }
  return ok({ kind: 'remove', id: root.id })
}

// ─── remove ───────────────────────────────────────────────────────────────

function remove(
  ctx: Context,
  op: Extract<CanvasOp, { kind: 'remove' }>,
): OpResult {
  const { draft } = ctx
  if (op.id === draft.base.rootId) return err({ code: 'ROOT', op: 'remove' })
  const node = draft.get(op.id)
  const parentId = node && draft.parentOf(op.id)
  if (!node || !parentId) return notFound(op.id)
  const parent = draft.get(parentId) as CanvasNode

  // Pre-order walk through the draft: the removed nodes become the inverse
  // insert's fragment (same objects, so undo restores identity).
  const subtree: CanvasNodeId[] = []
  const nodes: Record<CanvasNodeId, CanvasNode> = {}
  const stack = [op.id]
  while (stack.length > 0) {
    const id = stack.pop() as CanvasNodeId
    const current = draft.get(id) as CanvasNode
    subtree.push(id)
    nodes[id] = current
    if (!ctx.replay) {
      if (current.meta?.locked) return err({ code: 'LOCKED', id })
      if (definitionOf(ctx.catalog, current.type)?.required) {
        return err({ code: 'REQUIRED', type: current.type })
      }
    }
    const children = current.children ?? []
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
  }
  const tooFew = minError(ctx, parent)
  if (tooFew) return err(tooFew)

  const siblings = parent.children as CanvasNodeId[]
  const index = siblings.indexOf(op.id)
  draft.patch(parentId, { children: siblings.filter((id) => id !== op.id) })
  for (const id of subtree) draft.delete(id)
  return ok({
    kind: 'insert',
    fragment: { rootId: op.id, nodes },
    at: { parentId, index },
  })
}

// ─── move ─────────────────────────────────────────────────────────────────

function move(ctx: Context, op: Extract<CanvasOp, { kind: 'move' }>): OpResult {
  const { draft } = ctx
  if (op.id === draft.base.rootId) return err({ code: 'ROOT', op: 'move' })
  const node = draft.get(op.id)
  const fromId = node && draft.parentOf(op.id)
  if (!node || !fromId) return notFound(op.id)
  const target = draft.get(op.to.parentId)
  if (!target) return notFound(op.to.parentId)
  if (!ctx.replay && node.meta?.locked)
    return err({ code: 'LOCKED', id: op.id })
  if (draft.isSelfOrAncestor(op.id, target.id)) {
    return err({ code: 'CYCLE', id: op.id })
  }
  const from = draft.get(fromId) as CanvasNode
  const sameParent = from.id === target.id
  const refused =
    placementError(ctx.catalog, target, node.type) ??
    (sameParent ? null : (maxError(ctx, target) ?? minError(ctx, from)))
  if (refused) return err(refused)

  const fromChildren = from.children as CanvasNodeId[]
  const oldIndex = fromChildren.indexOf(op.id)
  let index = clampIndex(op.to.index, (target.children ?? []).length)
  if (sameParent && oldIndex < index) index -= 1

  const inverse: CanvasOp = {
    kind: 'move',
    id: op.id,
    to: {
      parentId: from.id,
      index: sameParent && index < oldIndex ? oldIndex + 1 : oldIndex,
    },
  }
  if (sameParent && index === oldIndex) return ok(inverse)

  const remaining = fromChildren.filter((id) => id !== op.id)
  if (sameParent) {
    remaining.splice(index, 0, op.id)
    draft.patch(from.id, { children: remaining })
  } else {
    const targetChildren = (target.children ?? []).slice()
    targetChildren.splice(index, 0, op.id)
    draft.patch(from.id, { children: remaining })
    draft.patch(target.id, { children: targetChildren })
    draft.reparent(op.id, target.id)
  }
  return ok(inverse)
}

// ─── update / meta ────────────────────────────────────────────────────────

function update(
  ctx: Context,
  op: Extract<CanvasOp, { kind: 'update' }>,
): OpResult {
  const node = ctx.draft.get(op.id)
  if (!node) return notFound(op.id)
  const definition = definitionOf(ctx.catalog, node.type)
  if (!definition) return err({ code: 'UNKNOWN_TYPE', type: node.type })

  let props = node.props
  const restore: Array<[string, unknown]> = []
  for (const [path, value] of Object.entries(op.set)) {
    if (!parsePath(path)) {
      return err({
        code: 'INVALID_PROPS',
        id: op.id,
        issues: [`${path}: invalid path`],
      })
    }
    restore.push(restoreEntry(props, path))
    props = setIn(props, path, value)
  }
  const inverse: CanvasOp = {
    kind: 'update',
    id: op.id,
    set: Object.fromEntries(restore.reverse()),
  }
  if (props === node.props) return ok(inverse)

  const issues = propsIssues(definition, props)
  if (issues) return err({ code: 'INVALID_PROPS', id: op.id, issues })
  ctx.draft.patch(op.id, { props })
  return ok(inverse)
}

function meta(ctx: Context, op: Extract<CanvasOp, { kind: 'meta' }>): OpResult {
  const node = ctx.draft.get(op.id)
  if (!node) return notFound(op.id)
  const current: Record<string, unknown> = node.meta ?? {}
  const next: Record<string, unknown> = { ...current }
  const restore: Record<string, unknown> = {}
  let changed = false
  for (const [key, value] of Object.entries(op.set)) {
    const previous = Object.hasOwn(current, key) ? current[key] : undefined
    restore[key] = previous
    if (Object.is(previous, value)) continue
    changed = true
    if (value === undefined) delete next[key]
    else next[key] = value
  }
  if (changed) {
    ctx.draft.patch(op.id, {
      meta: Object.keys(next).length > 0 ? next : undefined,
    })
  }
  return ok({ kind: 'meta', id: op.id, set: restore })
}

// ─── batch ────────────────────────────────────────────────────────────────

function batch(
  ctx: Context,
  op: Extract<CanvasOp, { kind: 'batch' }>,
): OpResult {
  const inverses: CanvasOp[] = []
  for (const child of op.ops) {
    const result = run(ctx, child)
    if (!result.ok) return result
    inverses.push(result.value)
  }
  return ok({ kind: 'batch', ops: inverses.reverse(), label: op.label })
}

// ─── queries ──────────────────────────────────────────────────────────────

/**
 * Would `childType` be accepted at `parentId`? Used by drag-over to paint
 * valid/invalid drop targets without applying anything. Pass `movingId` when
 * dragging an existing node: the cycle guard applies, the node's current
 * parent is not counted against `maxChildren`, its old parent's
 * `minChildren` is checked, and it does not count against `unique`.
 */
export function canDrop(
  doc: CanvasDocument,
  catalog: CanvasCatalog,
  childType: string,
  parentId: CanvasNodeId,
  movingId?: CanvasNodeId,
): boolean {
  const draft = new DocDraft(doc)
  const ctx: Context = { draft, catalog, replay: false }
  const parent = draft.get(parentId)
  if (!parent || placementError(catalog, parent, childType)) return false
  if (movingId === undefined) {
    return !maxError(ctx, parent) && !uniqueError(ctx, [childType])
  }
  const fromId = lookupParent(doc, movingId)
  if (!fromId || draft.isSelfOrAncestor(movingId, parentId)) return false
  if (fromId === parentId) return true
  return (
    !maxError(ctx, parent) && !minError(ctx, draft.get(fromId) as CanvasNode)
  )
}

// ─── fragments & documents ────────────────────────────────────────────────

function copyNode(
  node: CanvasNode,
  id: CanvasNodeId,
  map: Map<string, string>,
) {
  const copy: CanvasNode = {
    id,
    type: node.type,
    props: structuredClone(node.props),
  }
  if (node.children) {
    copy.children = node.children
      .filter((child) => map.has(child))
      .map((child) => map.get(child) as string)
  }
  if (node.meta) copy.meta = { ...node.meta }
  return copy
}

/**
 * Deep copy of a subtree with fresh cuid2 ids (paste, duplicate, saved
 * blocks, palette templates). Accepts a fragment (every root in `roots` is
 * cloned) or a node of a document. Children that do not resolve are
 * dropped. Throws when the source root is missing — a programming error.
 */
export function cloneFragment(
  source: CanvasFragment | { doc: CanvasDocument; id: CanvasNodeId },
): CanvasFragment {
  const lookup =
    'doc' in source
      ? (id: CanvasNodeId) => getNode(source.doc, id)
      : (id: CanvasNodeId) =>
          Object.hasOwn(source.nodes, id) ? source.nodes[id] : undefined
  const roots =
    'doc' in source ? [source.id] : (source.roots ?? [source.rootId])
  const map = new Map<string, string>()
  const originals: CanvasNode[] = []
  for (const root of roots) {
    if (!lookup(root)) throw new Error(`cloneFragment: node ${root} not found`)
    for (const id of collectSubtree(lookup, root)) {
      if (map.has(id)) continue
      map.set(id, createId())
      originals.push(lookup(id) as CanvasNode)
    }
  }
  const nodes: Record<CanvasNodeId, CanvasNode> = {}
  for (const original of originals) {
    const id = map.get(original.id) as string
    nodes[id] = copyNode(original, id, map)
  }
  const newRoots = roots.map((root) => map.get(root) as string)
  const fragment: CanvasFragment = { rootId: newRoots[0], nodes }
  if (newRoots.length > 1) fragment.roots = newRoots
  return fragment
}

/**
 * Fragment a palette item inserts for `type`: the definition's `template`
 * (with fresh ids) or a lone node with `defaultProps`. `null` for unknown
 * types.
 */
export function fragmentForType(
  catalog: CanvasCatalog,
  type: string,
): CanvasFragment | null {
  const definition = definitionOf(catalog, type)
  if (!definition) return null
  if (definition.template) return cloneFragment(definition.template())
  const id = createId()
  const node: CanvasNode = { id, type, props: definition.defaultProps() }
  if (definition.accepts !== false) node.children = []
  return { rootId: id, nodes: { [id]: node } }
}

/** New document with the catalog root (+ its default children, if any). */
export function createDocument(catalog: CanvasCatalog): CanvasDocument {
  const fragment = fragmentForType(catalog, catalog.rootType) as CanvasFragment
  const nodes = { ...fragment.nodes }
  const root = nodes[fragment.rootId]
  if (root.type !== catalog.rootType) {
    throw new Error(
      `Canvas catalog "${catalog.id}": the root template must start with ${catalog.rootType}`,
    )
  }
  delete nodes[fragment.rootId]
  nodes[ROOT_ID] = { ...root, id: ROOT_ID }
  return {
    catalog: catalog.id,
    version: catalog.version,
    rootId: ROOT_ID,
    nodes,
  }
}

/**
 * Full validation of a stored document (tree shape, catalog rules, every
 * node's props schema). Used on load and on the server before saving.
 * Reports every problem found, not just the first. A document of another
 * catalog version must be converted before validating.
 */
export function validateDocument(
  input: unknown,
  catalog: CanvasCatalog,
): Result<CanvasDocument, CanvasOpError[]> {
  const errors: CanvasOpError[] = []
  const invalid = (reason: string) =>
    errors.push({ code: 'INVALID_DOCUMENT', reason })

  if (!isRecord(input)) {
    return err([{ code: 'INVALID_DOCUMENT', reason: 'not an object' }])
  }
  if (input.catalog !== catalog.id) invalid(`catalog must be "${catalog.id}"`)
  if (input.version !== catalog.version) {
    invalid(`version must be ${catalog.version}`)
  }
  if (input.rootId !== ROOT_ID) invalid(`rootId must be "${ROOT_ID}"`)
  if (!isRecord(input.nodes)) {
    invalid('nodes must be an object')
    return err(errors)
  }
  const nodes = input.nodes
  for (const [key, node] of Object.entries(nodes)) {
    if (!isNodeShape(node, key)) invalid(`malformed node ${key}`)
  }
  if (errors.length > 0) return err(errors)

  const doc = input as unknown as CanvasDocument
  const lookup = (id: CanvasNodeId) =>
    Object.hasOwn(doc.nodes, id) ? doc.nodes[id] : undefined
  const root = lookup(ROOT_ID)
  if (!root) return err([{ code: 'NODE_NOT_FOUND', id: ROOT_ID }])
  if (root.type !== catalog.rootType) {
    invalid(`root must be ${catalog.rootType}`)
  }

  const reachable = new Set<CanvasNodeId>([ROOT_ID])
  const stack = [ROOT_ID]
  while (stack.length > 0) {
    const node = lookup(stack.pop() as CanvasNodeId) as CanvasNode
    for (const child of node.children ?? []) {
      if (!lookup(child)) errors.push({ code: 'NODE_NOT_FOUND', id: child })
      else if (reachable.has(child)) errors.push({ code: 'CYCLE', id: child })
      else {
        reachable.add(child)
        stack.push(child)
      }
    }
  }
  for (const id of Object.keys(doc.nodes)) {
    if (!reachable.has(id)) invalid(`node ${id} is not reachable from the root`)
  }

  const counts = new Map<string, number>()
  for (const id of reachable) {
    const node = doc.nodes[id]
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1)
    errors.push(...nodeIssues(catalog, node, lookup))
  }
  for (const definition of Object.values(catalog.components)) {
    const count = counts.get(definition.type) ?? 0
    if (definition.unique && count > 1) {
      errors.push({ code: 'UNIQUE', type: definition.type })
    }
    if (definition.required && count === 0) {
      errors.push({ code: 'REQUIRED', type: definition.type })
    }
  }
  return errors.length > 0 ? err(errors) : ok(doc)
}
