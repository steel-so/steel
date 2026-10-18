import { getNode } from './nodes'
import type { CanvasOp } from './ops'
import { getIn, jsonEqual } from './path'
import type { CanvasDocument, CanvasNode, CanvasNodeId } from './types'

/**
 * Compare-and-set for undo/redo under real-time co-editing (ADR 0027).
 *
 * A history step's return trip (the inverse for undo, the forward op for
 * redo) writes values back into props paths and meta keys. When someone else
 * changed one of those fields after this user's step, writing it back would
 * silently overwrite their newer change. So each step remembers, per node and
 * field, the value it left there (`expectationsFor`), and before travelling
 * `guardOp` drops the writes whose field no longer holds that value — the
 * rest of the step still applies.
 */

/** One field a history step writes: a props path or a meta key. */
export interface CanvasHistoryField {
  id: CanvasNodeId
  field: 'props' | 'meta'
  path: string
}

/** Field key → value this user's step left there. */
export type HistoryExpectations = Map<string, unknown>

const keyOf = ({ id, field, path }: CanvasHistoryField) =>
  `${field}\u0000${id}\u0000${path}`

function read(node: CanvasNode, field: CanvasHistoryField): unknown {
  if (field.field === 'props') return getIn(node.props, field.path)
  const meta: Record<string, unknown> = node.meta ?? {}
  return Object.hasOwn(meta, field.path) ? meta[field.path] : undefined
}

/** Every props path / meta key `op` writes, in application order. */
function fieldsOf(op: CanvasOp, out: CanvasHistoryField[]): void {
  switch (op.kind) {
    case 'update':
      for (const path of Object.keys(op.set)) {
        out.push({ id: op.id, field: 'props', path })
      }
      return
    case 'meta':
      for (const path of Object.keys(op.set)) {
        out.push({ id: op.id, field: 'meta', path })
      }
      return
    case 'batch':
      for (const child of op.ops) fieldsOf(child, out)
      return
    default:
      // insert/remove/move are structural: the replay validation covers them.
      return
  }
}

/**
 * What `doc` — the document a step just produced — holds at each field the
 * step's return trip `op` will write. Structural ops add nothing.
 */
export function expectationsFor(
  doc: CanvasDocument,
  op: CanvasOp,
): HistoryExpectations {
  const fields: CanvasHistoryField[] = []
  fieldsOf(op, fields)
  const expected: HistoryExpectations = new Map()
  for (const field of fields) {
    const key = keyOf(field)
    if (expected.has(key)) continue
    const node = getNode(doc, field.id)
    if (node) expected.set(key, read(node, field))
  }
  return expected
}

export interface GuardedOp {
  /** The op without the conflicting writes; `null` when nothing is left. */
  op: CanvasOp | null
  /** Fields left alone because someone else changed them. */
  skipped: CanvasHistoryField[]
}

/**
 * `op` without the writes whose field in `doc` (the current document) no
 * longer holds the expected value. A field without expectation, or on a node
 * that no longer exists, is kept (the replay validation decides). Unchanged
 * parts keep their identity.
 */
export function guardOp(
  doc: CanvasDocument,
  op: CanvasOp,
  expected: HistoryExpectations,
): GuardedOp {
  const skipped = new Map<string, CanvasHistoryField>()
  const conflicts = (field: CanvasHistoryField): boolean => {
    const key = keyOf(field)
    const node = getNode(doc, field.id)
    if (!node || !expected.has(key)) return false
    if (jsonEqual(read(node, field), expected.get(key))) return false
    skipped.set(key, field)
    return true
  }

  const visit = (current: CanvasOp): CanvasOp | null => {
    switch (current.kind) {
      case 'update':
      case 'meta': {
        const field = current.kind === 'update' ? 'props' : 'meta'
        const entries = Object.entries(current.set)
        const kept = entries.filter(
          ([path]) => !conflicts({ id: current.id, field, path }),
        )
        if (kept.length === entries.length) return current
        if (kept.length === 0) return null
        return { ...current, set: Object.fromEntries(kept) } as CanvasOp
      }
      case 'batch': {
        const ops = current.ops.map(visit)
        if (ops.every((child, i) => child === current.ops[i])) return current
        const kept = ops.filter((child): child is CanvasOp => child !== null)
        return kept.length === 0 ? null : { ...current, ops: kept }
      }
      default:
        return current
    }
  }

  const guarded = visit(op)
  return { op: guarded, skipped: [...skipped.values()] }
}
