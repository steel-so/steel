import { deriveDocument, getNode, type NodeChanges, REMOVED } from './nodes'
import { deriveIndex, GONE, lookupParent, type ParentPatch } from './tree'
import type { CanvasDocument, CanvasNode, CanvasNodeId } from './types'

/**
 * Working copy of a document while one op (or a whole batch) is applied.
 * Changes are collected in a map — nothing proportional to the document size
 * is copied — and `commit()` turns them into an overlay document. Each
 * touched node is copied once; untouched nodes keep their identity. `commit()`
 * returns the original document when nothing changed.
 */
export class DocDraft {
  private readonly changes: NodeChanges = new Map()
  /** Node objects created by this draft — safe to mutate in place. */
  private readonly owned = new Set<CanvasNodeId>()
  private readonly parents: ParentPatch = new Map()

  constructor(readonly base: CanvasDocument) {}

  get(id: CanvasNodeId): CanvasNode | undefined {
    const changed = this.changes.get(id)
    if (changed === undefined) return getNode(this.base, id)
    return changed === REMOVED ? undefined : changed
  }

  /** Parent of a node as of this draft (`undefined` when absent). */
  parentOf(id: CanvasNodeId): CanvasNodeId | null | undefined {
    if (this.parents.has(id)) {
      const parent = this.parents.get(id)
      return parent === GONE ? undefined : parent
    }
    return lookupParent(this.base, id)
  }

  /** Whether `ancestorId` is `id` or one of its ancestors. O(depth). */
  isSelfOrAncestor(ancestorId: CanvasNodeId, id: CanvasNodeId): boolean {
    for (
      let current: CanvasNodeId | null | undefined = id;
      current != null;
      current = this.parentOf(current)
    ) {
      if (current === ancestorId) return true
    }
    return false
  }

  /** Every node currently in the draft. O(n) — only for rare rule checks
   * (`unique`). */
  values(): CanvasNode[] {
    const out: CanvasNode[] = []
    for (const node of Object.values(this.base.nodes)) {
      if (!this.changes.has(node.id)) out.push(node)
    }
    for (const node of this.changes.values()) {
      if (node !== REMOVED) out.push(node)
    }
    return out
  }

  /** Adds a node object as-is (shared with its fragment, never mutated). */
  put(node: CanvasNode, parentId: CanvasNodeId): void {
    this.changes.set(node.id, node)
    this.owned.delete(node.id)
    this.parents.set(node.id, parentId)
  }

  delete(id: CanvasNodeId): void {
    this.changes.set(id, REMOVED)
    this.owned.delete(id)
    this.parents.set(id, GONE)
  }

  /** Replaces fields of a node; a field set to `undefined` is removed. */
  patch(id: CanvasNodeId, fields: Partial<CanvasNode>): void {
    let node = this.get(id) as CanvasNode
    if (!this.owned.has(id)) {
      node = { ...node }
      this.changes.set(id, node)
      this.owned.add(id)
    }
    for (const [key, value] of Object.entries(fields)) {
      const field = key as keyof CanvasNode
      if (value === undefined) delete node[field]
      else (node as unknown as Record<string, unknown>)[field] = value
    }
  }

  /** Records `childId`'s parent without touching nodes (moves). */
  reparent(childId: CanvasNodeId, parentId: CanvasNodeId): void {
    this.parents.set(childId, parentId)
  }

  commit(): CanvasDocument {
    if (this.changes.size === 0) return this.base
    const next = deriveDocument(this.base, this.changes)
    deriveIndex(this.base, next, this.parents)
    return next
  }
}
