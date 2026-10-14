import { describe, expect, it } from 'vitest'
import {
  applyOp,
  type CanvasOp,
  fragmentForType,
  parentOf,
  validateDocument,
} from '@/src/lib/canvas/ops'
import { createCanvasStore } from '@/src/lib/canvas/store'
import type { CanvasDocument, CanvasNodeId } from '@/src/lib/canvas/types'
import { catalog, node, sampleDoc } from './canvas-fixture'

/** Deterministic PRNG (mulberry32) so a failure is reproducible by seed. */
function rng(seed: number) {
  let a = seed
  const next = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (max: number) => Math.floor(next() * max)
  const pick = <T>(items: T[]): T => items[int(items.length)]
  return { int, pick }
}

const TYPES = [
  'demo.section',
  'demo.columns',
  'demo.column',
  'demo.text',
  'demo.button',
]

function randomOp(doc: CanvasDocument, r: ReturnType<typeof rng>): CanvasOp {
  const ids = Object.keys(doc.nodes)
  const id = r.pick(ids)
  const index = r.int(5) - 1
  switch (r.int(7)) {
    case 0: {
      const fragment = fragmentForType(catalog, r.pick(TYPES))
      if (!fragment) throw new Error('unreachable')
      return { kind: 'insert', fragment, at: { parentId: id, index } }
    }
    case 1:
      return { kind: 'remove', id }
    case 2:
      return { kind: 'move', id, to: { parentId: r.pick(ids), index } }
    case 3: {
      const set: Record<string, unknown> =
        doc.nodes[id].type === 'demo.text'
          ? r.pick([
              { text: `t${r.int(100)}` },
              { 'style.padding.top': r.int(40) },
              { style: undefined, items: ['a', 'b'] },
              { 'items.0': undefined },
              { size: { base: 16, mobile: r.int(20) } },
            ])
          : doc.nodes[id].type === 'demo.button'
            ? {
                label: r.pick(['', 'Ok', 'Comprar']),
                href: r.pick([undefined, '/x']),
              }
            : { background: r.pick([undefined, '#fff']) }
      return { kind: 'update', id, set }
    }
    case 4:
      return {
        kind: 'meta',
        id,
        set: r.pick([
          { name: 'n' },
          { hidden: true },
          { name: undefined, hidden: undefined },
        ]),
      }
    case 5:
      return {
        kind: 'batch',
        ops: [randomOp(doc, r), randomOp(doc, r)],
      }
    default:
      return {
        kind: 'move',
        id,
        to: { parentId: parentOf(doc, id) ?? id, index },
      }
  }
}

describe('random op sequences', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'undo-all restores the original (seed %i)',
    (seed) => {
      const r = rng(seed)
      const original = sampleDoc()
      let doc = original
      const inverses: CanvasOp[] = []
      let applied = 0
      for (let i = 0; i < 300; i++) {
        const result = applyOp(doc, randomOp(doc, r), catalog)
        if (!result.ok) continue
        applied++
        doc = result.value.doc
        inverses.push(result.value.inverse)
        // Every accepted op keeps the document valid.
        expect(validateDocument(doc, catalog).ok).toBe(true)
      }
      expect(applied).toBeGreaterThan(50)
      for (const inverse of inverses.reverse()) {
        const result = applyOp(doc, inverse, catalog, { replay: true })
        if (!result.ok)
          throw new Error(`inverse refused: ${JSON.stringify(result.error)}`)
        doc = result.value.doc
      }
      expect(doc).toEqual(original)
      // Parent index of the final document agrees with the tree.
      for (const [id, current] of Object.entries(doc.nodes)) {
        for (const child of current.children ?? [])
          expect(parentOf(doc, child)).toBe(id)
      }
    },
  )

  it.each([11, 12, 13])(
    'store undo-all / redo-all round trip (seed %i)',
    (seed) => {
      const r = rng(seed)
      const store = createCanvasStore(catalog, sampleDoc())
      for (let i = 0; i < 150; i++) {
        store.dispatch(randomOp(store.getState().doc, r), {
          coalesce: r.int(2) === 0,
        })
      }
      const final = store.getState().doc
      while (store.getState().canUndo) store.undo()
      expect(store.getState().doc).toEqual(sampleDoc())
      expect(store.getState().dirty).toBe(false)
      while (store.getState().canRedo) store.redo()
      expect(store.getState().doc).toEqual(final)
    },
  )
})

/** root + footer + 250 × (section, columns, 2 columns, 4 leaves) = 2,002
 * nodes. */
function bigDoc(): CanvasDocument {
  const nodes: CanvasDocument['nodes'] = {}
  const sections: CanvasNodeId[] = []
  for (let i = 0; i < 250; i++) {
    const [s, cols, c1, c2] = [`s${i}`, `k${i}`, `a${i}`, `b${i}`]
    sections.push(s)
    nodes[s] = node(s, 'demo.section', {}, [cols])
    nodes[cols] = node(cols, 'demo.columns', { gap: 8 }, [c1, c2])
    nodes[c1] = node(c1, 'demo.column', {}, [`t${i}`, `u${i}`])
    nodes[c2] = node(c2, 'demo.column', {}, [`v${i}`, `w${i}`])
    for (const leaf of [`t${i}`, `u${i}`, `v${i}`]) {
      nodes[leaf] = node(leaf, 'demo.text', {
        text: leaf,
        style: { color: '#000' },
      })
    }
    nodes[`w${i}`] = node(`w${i}`, 'demo.button', { label: 'Ok' })
  }
  nodes.footer = node('footer', 'demo.footer', { address: 'Rua A, 1' })
  nodes.root = node('root', 'demo.page', {}, [...sections, 'footer'])
  return { catalog: 'demo', version: 1, rootId: 'root', nodes }
}

describe('performance on a 2,000-node document', () => {
  it('applies each kind of op in well under 1 ms', () => {
    let doc = bigDoc()
    expect(Object.keys(doc.nodes)).toHaveLength(2002)
    expect(validateDocument(doc, catalog).ok).toBe(true)
    parentOf(doc, 'root') // one-time O(n) index build

    const rounds = 400
    const timings: Record<string, number> = {}
    const time = (label: string, make: (i: number) => CanvasOp) => {
      const start = performance.now()
      for (let i = 0; i < rounds; i++) {
        const result = applyOp(doc, make(i), catalog)
        if (!result.ok)
          throw new Error(`${label}: ${JSON.stringify(result.error)}`)
        doc = result.value.doc
      }
      timings[label] = (performance.now() - start) / rounds
    }

    time('update', (i) => ({
      kind: 'update',
      id: `t${i % 250}`,
      set: { text: `x${i}` },
    }))
    time('move', (i) => ({
      kind: 'move',
      id: `u${i % 250}`,
      to: { parentId: i % 2 === 0 ? `b${i % 250}` : `a${i % 250}`, index: 0 },
    }))
    time('insert', (i) => ({
      kind: 'insert',
      fragment: {
        rootId: `n${i}`,
        nodes: { [`n${i}`]: node(`n${i}`, 'demo.text', { text: 'n' }) },
      },
      at: { parentId: `a${i % 250}`, index: 0 },
    }))
    time('remove', (i) => ({ kind: 'remove', id: `n${i}` }))
    time('batch', (i) => ({
      kind: 'batch',
      ops: [
        { kind: 'update', id: `v${i % 250}`, set: { 'style.color': '#fff' } },
        {
          kind: 'move',
          id: `v${i % 250}`,
          to: { parentId: `a${i % 250}`, index: 0 },
        },
        {
          kind: 'move',
          id: `v${i % 250}`,
          to: { parentId: `b${i % 250}`, index: 0 },
        },
      ],
    }))

    // Locally ~0.03–0.05 ms per op; the bound leaves 10× room for slow CI
    // runners and coverage instrumentation.
    for (const [label, ms] of Object.entries(timings)) {
      expect(ms, `${label} took ${ms.toFixed(3)} ms per op`).toBeLessThan(0.5)
    }
    expect(parentOf(doc, 'u0')).toBe('b0')
  })
})
