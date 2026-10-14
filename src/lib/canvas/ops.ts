import type { Result } from '@/src/lib/result'
import type { CanvasCatalog } from './registry'
import type {
  CanvasDocument,
  CanvasFragment,
  CanvasLocation,
  CanvasNodeId,
} from './types'

/**
 * Every change to a document is one of these operations. They are pure:
 * `applyOp` returns a new document (structural sharing — untouched nodes keep
 * their identity, so React memo works) and the inverse op for undo.
 */
export type CanvasOp =
  /** Insert a fragment; its ids must already be unique in the document. */
  | { kind: 'insert'; fragment: CanvasFragment; at: CanvasLocation }
  /** Remove a node and its subtree. The inverse is an insert of that subtree. */
  | { kind: 'remove'; id: CanvasNodeId }
  | { kind: 'move'; id: CanvasNodeId; to: CanvasLocation }
  /** Set props by dot path (`style.padding.top`). `undefined` deletes the key. */
  | { kind: 'update'; id: CanvasNodeId; set: Record<string, unknown> }
  | {
      kind: 'meta'
      id: CanvasNodeId
      set: Partial<NonNullable<import('./types').CanvasNode['meta']>>
    }
  /** Several ops applied (and undone) as one step. */
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

export interface AppliedOp {
  doc: CanvasDocument
  inverse: CanvasOp
}

const NOT_IMPLEMENTED = 'canvas core: implemented by the canvas-core slice'

/** Validates against the catalog (accepts/parents/max/min/required/unique/
 * locked/props schema) and applies. Never throws. */
export function applyOp(
  _doc: CanvasDocument,
  _op: CanvasOp,
  _catalog: CanvasCatalog,
): Result<AppliedOp, CanvasOpError> {
  throw new Error(NOT_IMPLEMENTED)
}

/** Would `childType` be accepted at `parentId`? Used by drag-over to paint
 * valid/invalid drop targets without applying anything. */
export function canDrop(
  _doc: CanvasDocument,
  _catalog: CanvasCatalog,
  _childType: string,
  _parentId: CanvasNodeId,
): boolean {
  throw new Error(NOT_IMPLEMENTED)
}

/** Copy of a subtree with fresh ids (paste, duplicate, saved blocks). */
export function cloneFragment(
  _source: CanvasFragment | { doc: CanvasDocument; id: CanvasNodeId },
): CanvasFragment {
  throw new Error(NOT_IMPLEMENTED)
}

/** New document with the catalog root (+ its default children, if any). */
export function createDocument(_catalog: CanvasCatalog): CanvasDocument {
  throw new Error(NOT_IMPLEMENTED)
}

/** Full validation of a stored document (tree shape, catalog rules, every
 * node's props schema). Used on load and on the server before saving. */
export function validateDocument(
  _doc: unknown,
  _catalog: CanvasCatalog,
): Result<CanvasDocument, CanvasOpError[]> {
  throw new Error(NOT_IMPLEMENTED)
}

/** Parent id of a node (`null` for the root). O(1) via a cached index. */
export function parentOf(
  _doc: CanvasDocument,
  _id: CanvasNodeId,
): CanvasNodeId | null {
  throw new Error(NOT_IMPLEMENTED)
}

/** Resolves a `Responsive<T>` (or plain `T`) for a breakpoint, cascading
 * base → tablet → mobile. */
export function resolveResponsive<T>(
  _value: T | import('./types').Responsive<T>,
  _breakpoint: import('./types').CanvasBreakpoint,
): T {
  throw new Error(NOT_IMPLEMENTED)
}
