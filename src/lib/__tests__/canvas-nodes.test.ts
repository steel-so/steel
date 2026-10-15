import { describe, expect, it } from 'vitest'
import {
  applyOp,
  type CanvasOp,
  childOnPath,
  getNode,
} from '@/src/lib/canvas/ops'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { catalog, sampleDoc } from './canvas-fixture'

function apply(doc: CanvasDocument, op: CanvasOp): CanvasDocument {
  const result = applyOp(doc, op, catalog)
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value.doc
}

const rename = (id: string, text: string): CanvasOp => ({
  kind: 'update',
  id,
  set: { text },
})

describe('overlay documents', () => {
  it('reads nodes through the overlay without touching the base', () => {
    const base = sampleDoc()
    const next = apply(base, { kind: 'remove', id: 't2' })
    expect(getNode(next, 't2')).toBeUndefined()
    expect(getNode(next, 't1')).toBe(base.nodes.t1)
    expect(getNode(next, 'nope')).toBeUndefined()
    expect(getNode(base, 't2')).toBe(base.nodes.t2)
    expect(getNode(base, 'constructor')).toBeUndefined()
  })

  it('exposes nodes as a real, enumerable, cached record', () => {
    const base = sampleDoc()
    const next = apply(apply(base, rename('t1', 'a')), {
      kind: 'remove',
      id: 't2',
    })
    const nodes = next.nodes
    expect(next.nodes).toBe(nodes)
    expect(Object.keys(nodes).sort()).toEqual(
      Object.keys(base.nodes)
        .filter((id) => id !== 't2')
        .sort(),
    )
    expect(nodes.t1.props.text).toBe('a')
    expect(Object.keys(next)).toEqual(['catalog', 'version', 'rootId', 'nodes'])
    expect(JSON.parse(JSON.stringify(next)).nodes.t1.props.text).toBe('a')
    expect({ ...next }.nodes).toBe(nodes)
    expect(structuredClone(next).nodes.t1.props.text).toBe('a')
  })

  it('keeps reading correctly after an intermediate document materializes', () => {
    const base = sampleDoc()
    const one = apply(base, rename('t1', 'one'))
    const two = apply(one, rename('t2', 'two'))
    expect(one.nodes.t1.props.text).toBe('one') // materializes `one`
    const three = apply(two, rename('t1', 'three'))
    const four = apply(one, rename('t2', 'four'))
    expect(getNode(two, 't1')?.props.text).toBe('one')
    expect(getNode(two, 't2')?.props.text).toBe('two')
    expect(getNode(three, 't1')?.props.text).toBe('three')
    expect(getNode(four, 't2')?.props.text).toBe('four')
    expect(four.nodes.t1.props.text).toBe('one')
  })

  it('materializes long chains on its own and stays consistent', () => {
    let doc = sampleDoc()
    for (let i = 0; i < 100; i++) doc = apply(doc, rename('t1', `v${i}`))
    expect(getNode(doc, 't1')?.props.text).toBe('v99')
    expect(getNode(doc, 'b1')?.props).toEqual({ label: 'Comprar' })
    expect(doc.nodes.t1.props.text).toBe('v99')
    expect(Object.keys(doc.nodes)).toHaveLength(10)
  })

  it('copies header fields added by a catalog', () => {
    const base = { ...sampleDoc(), settings: { width: 600 } } as CanvasDocument
    const next = apply(base, rename('t1', 'x'))
    expect((next as unknown as { settings: unknown }).settings).toEqual({
      width: 600,
    })
  })
})

describe('childOnPath', () => {
  it('finds the direct child of an ancestor on the way to a node', () => {
    const doc = sampleDoc()
    expect(childOnPath(doc, 's1', 'b1')).toBe('cols')
    expect(childOnPath(doc, 'cols', 'b1')).toBe('c1')
    expect(childOnPath(doc, 'cols', 'c2')).toBe('c2')
    expect(childOnPath(doc, 'root', 't2')).toBe('s2')
  })

  it('is null outside the subtree, for the ancestor itself and without a node', () => {
    const doc = sampleDoc()
    expect(childOnPath(doc, 's1', 't2')).toBeNull()
    expect(childOnPath(doc, 's1', 's1')).toBeNull()
    expect(childOnPath(doc, 's1', null)).toBeNull()
    expect(childOnPath(doc, 's1', undefined)).toBeNull()
    expect(childOnPath(doc, 's1', 'missing')).toBeNull()
  })
})
