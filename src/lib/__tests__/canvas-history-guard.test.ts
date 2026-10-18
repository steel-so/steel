import { describe, expect, it } from 'vitest'
import { expectationsFor, guardOp } from '@/src/lib/canvas/history-guard'
import type { CanvasOp } from '@/src/lib/canvas/ops'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { node, sampleDoc } from './canvas-fixture'

function withNode(
  doc: CanvasDocument,
  id: string,
  patch: Partial<CanvasDocument['nodes'][string]>,
): CanvasDocument {
  return {
    ...doc,
    nodes: { ...doc.nodes, [id]: { ...doc.nodes[id], ...patch } },
  }
}

describe('expectationsFor', () => {
  it('records the value at every props path and meta key the op writes', () => {
    const doc = withNode(sampleDoc(), 't1', { meta: { name: 'Título' } })
    const op: CanvasOp = {
      kind: 'batch',
      ops: [
        { kind: 'update', id: 't1', set: { text: 'x', 'style.color': '#1' } },
        { kind: 'meta', id: 't1', set: { name: 'y', hidden: true } },
        { kind: 'update', id: 't1', set: { text: 'z' } },
        { kind: 'remove', id: 'b1' },
        { kind: 'update', id: 'gone', set: { text: 'w' } },
      ],
    }
    const expected = expectationsFor(doc, op)
    expect([...expected.entries()]).toEqual([
      ['props\u0000t1\u0000text', 'Olá'],
      ['props\u0000t1\u0000style.color', '#000'],
      ['meta\u0000t1\u0000name', 'Título'],
      ['meta\u0000t1\u0000hidden', undefined],
    ])
  })

  it('records nothing for structural ops', () => {
    const op: CanvasOp = {
      kind: 'move',
      id: 't2',
      to: { parentId: 's1', index: 0 },
    }
    expect(expectationsFor(sampleDoc(), op).size).toBe(0)
  })
})

describe('guardOp', () => {
  const update: CanvasOp = {
    kind: 'update',
    id: 't1',
    set: { text: 'antes', 'style.color': '#fff' },
  }
  const base = sampleDoc()
  const expected = expectationsFor(base, update)

  it('keeps the op (same object) when every field is as expected', () => {
    const guarded = guardOp(base, update, expected)
    expect(guarded.op).toBe(update)
    expect(guarded.skipped).toEqual([])
  })

  it('compares structurally, not by identity', () => {
    const rebuilt = withNode(base, 't1', {
      props: { text: 'Olá', style: { color: '#000' } },
    })
    const op: CanvasOp = { kind: 'update', id: 't1', set: { style: undefined } }
    expect(guardOp(rebuilt, op, expectationsFor(base, op)).op).toBe(op)
  })

  it('drops only the fields someone else changed', () => {
    const changed = withNode(base, 't1', {
      props: { text: 'de outra pessoa', style: { color: '#000' } },
    })
    expect(guardOp(changed, update, expected)).toEqual({
      op: { kind: 'update', id: 't1', set: { 'style.color': '#fff' } },
      skipped: [{ id: 't1', field: 'props', path: 'text' }],
    })
  })

  it('returns null when nothing is left', () => {
    const changed = withNode(base, 't1', {
      props: { text: 'outra', style: { color: '#123' } },
    })
    const guarded = guardOp(changed, update, expected)
    expect(guarded.op).toBeNull()
    expect(guarded.skipped).toHaveLength(2)
  })

  it('keeps fields without expectation and nodes that are gone', () => {
    const op: CanvasOp = { kind: 'update', id: 't1', set: { size: 3 } }
    expect(guardOp(base, op, new Map()).op).toBe(op)
    const gone: CanvasOp = { kind: 'update', id: 'x', set: { text: 'a' } }
    const removed = { ...base, nodes: { ...base.nodes } }
    delete removed.nodes.t1
    expect(guardOp(removed, update, expected).op).toBe(update)
    expect(guardOp(base, gone, expected).op).toBe(gone)
  })

  it('guards meta keys, absent keys included', () => {
    const op: CanvasOp = { kind: 'meta', id: 't1', set: { name: undefined } }
    const after = withNode(base, 't1', { meta: { name: 'A' } })
    const exp = expectationsFor(after, op)
    expect(guardOp(after, op, exp).op).toBe(op)
    const renamed = withNode(base, 't1', { meta: { name: 'B' } })
    expect(guardOp(renamed, op, exp)).toEqual({
      op: null,
      skipped: [{ id: 't1', field: 'meta', path: 'name' }],
    })
    // Absent key expected, someone set it.
    const absent: CanvasOp = { kind: 'meta', id: 't1', set: { hidden: true } }
    const absentExp = expectationsFor(base, absent)
    const hidden = withNode(base, 't1', { meta: { hidden: false } })
    expect(guardOp(hidden, absent, absentExp).op).toBeNull()
  })

  it('filters batches, keeps structural children and reports a field once', () => {
    const batch: Extract<CanvasOp, { kind: 'batch' }> = {
      kind: 'batch',
      label: 'grupo',
      ops: [
        { kind: 'update', id: 't1', set: { text: 'a' } },
        { kind: 'update', id: 't2', set: { text: 'b' } },
        { kind: 'update', id: 't1', set: { text: 'c' } },
        {
          kind: 'insert',
          fragment: {
            rootId: 'n',
            nodes: { n: node('n', 'demo.text', { text: '' }) },
          },
          at: { parentId: 's2', index: 0 },
        },
      ],
    }
    const exp = expectationsFor(base, batch)
    expect(guardOp(base, batch, exp).op).toBe(batch)
    const changed = withNode(base, 't1', { props: { text: 'outra' } })
    const guarded = guardOp(changed, batch, exp)
    expect(guarded.op).toEqual({
      kind: 'batch',
      label: 'grupo',
      ops: [batch.ops[1], batch.ops[3]],
    })
    expect(guarded.skipped).toEqual([
      { id: 't1', field: 'props', path: 'text' },
    ])
  })

  it('returns null for a batch with nothing left', () => {
    const batch: CanvasOp = {
      kind: 'batch',
      ops: [{ kind: 'update', id: 't1', set: { text: 'a' } }],
    }
    const changed = withNode(base, 't1', { props: { text: 'outra' } })
    expect(guardOp(changed, batch, expectationsFor(base, batch)).op).toBeNull()
  })
})
