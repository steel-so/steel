import { afterEach, describe, expect, it } from 'vitest'
import { DocDraft } from '@/src/lib/canvas/draft'
import {
  applyOp,
  type CanvasOp,
  canDrop,
  cloneFragment,
  createDocument,
  fragmentForType,
  parentOf,
  resolveResponsive,
  validateDocument,
} from '@/src/lib/canvas/ops'
import { defineCatalog } from '@/src/lib/canvas/registry'
import type { CanvasDocument, CanvasFragment } from '@/src/lib/canvas/types'
import {
  catalog,
  node,
  outline,
  sampleDoc,
  schemaSwitch,
} from './canvas-fixture'

afterEach(() => {
  schemaSwitch.strictText = false
})

function apply(doc: CanvasDocument, op: CanvasOp, replay = false) {
  const result = applyOp(doc, op, catalog, { replay })
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`)
  return result.value
}

function refused(doc: CanvasDocument, op: CanvasOp) {
  const result = applyOp(doc, op, catalog)
  if (result.ok) throw new Error('expected the op to be refused')
  return result.error
}

/** Applies, undoes, and checks the round trip restores the document. */
function roundTrip(doc: CanvasDocument, op: CanvasOp) {
  const { doc: next, inverse } = apply(doc, op)
  const { doc: back } = apply(next, inverse, true)
  expect(back).toEqual(doc)
  return next
}

const text = (id: string, value = 'Novo'): CanvasFragment => ({
  rootId: id,
  nodes: { [id]: node(id, 'demo.text', { text: value }) },
})

describe('insert', () => {
  it('inserts at an index with structural sharing', () => {
    const doc = sampleDoc()
    const next = roundTrip(doc, {
      kind: 'insert',
      fragment: text('n1'),
      at: { parentId: 's2', index: 0 },
    })
    expect(next.nodes.s2.children).toEqual(['n1', 't2'])
    expect(next.nodes.t2).toBe(doc.nodes.t2)
    expect(next.nodes.s1).toBe(doc.nodes.s1)
    expect(next.nodes.s2).not.toBe(doc.nodes.s2)
    expect(doc.nodes.s2.children).toEqual(['t2'])
    expect(parentOf(next, 'n1')).toBe('s2')
  })

  it('inserts a whole subtree and clamps the index', () => {
    const doc = sampleDoc()
    const fragment = fragmentForType(catalog, 'demo.columns') as CanvasFragment
    const next = roundTrip(doc, {
      kind: 'insert',
      fragment,
      at: { parentId: 's2', index: 99 },
    })
    const [, inserted] = next.nodes.s2.children ?? []
    expect(inserted).toBe(fragment.rootId)
    const [col] = next.nodes[inserted].children ?? []
    expect(parentOf(next, col)).toBe(inserted)
    expect(
      apply(doc, {
        kind: 'insert',
        fragment: text('n2'),
        at: { parentId: 's2', index: -4 },
      }).doc.nodes.s2.children,
    ).toEqual(['n2', 't2'])
    expect(
      apply(doc, {
        kind: 'insert',
        fragment: text('n3'),
        at: { parentId: 's2', index: Number.NaN },
      }).doc.nodes.s2.children,
    ).toEqual(['t2', 'n3'])
  })

  it('inserts into a container without a children array', () => {
    const doc = sampleDoc()
    doc.nodes.c2 = node('c2', 'demo.column', {})
    doc.nodes.s2 = node('s2', 'demo.section', {})
    delete doc.nodes.t2
    for (const parentId of ['c2', 's2']) {
      const next = apply(doc, {
        kind: 'insert',
        fragment: text('n1'),
        at: { parentId, index: 0 },
      }).doc
      expect(next.nodes[parentId].children).toEqual(['n1'])
    }
  })

  it('refuses a missing parent or fragment node', () => {
    const doc = sampleDoc()
    expect(
      refused(doc, {
        kind: 'insert',
        fragment: text('n1'),
        at: { parentId: 'x', index: 0 },
      }),
    ).toEqual({ code: 'NODE_NOT_FOUND', id: 'x' })
    expect(
      refused(doc, {
        kind: 'insert',
        fragment: { rootId: 'n1', nodes: {} },
        at: { parentId: 's2', index: 0 },
      }),
    ).toEqual({ code: 'NODE_NOT_FOUND', id: 'n1' })
    expect(
      refused(doc, {
        kind: 'insert',
        fragment: { rootId: 'n1', nodes: null as never },
        at: { parentId: 's2', index: 0 },
      }),
    ).toEqual({ code: 'NODE_NOT_FOUND', id: 'n1' })
    expect(
      refused(doc, {
        kind: 'insert',
        fragment: {
          rootId: 'n1',
          nodes: { n1: node('n1', 'demo.columns', {}, ['ghost']) },
        },
        at: { parentId: 's2', index: 0 },
      }),
    ).toEqual({ code: 'NODE_NOT_FOUND', id: 'ghost' })
  })

  it('refuses malformed fragments, duplicate ids and cycles', () => {
    const doc = sampleDoc()
    const at = { parentId: 's2', index: 0 }
    expect(
      refused(doc, {
        kind: 'insert',
        fragment: {
          rootId: 'n1',
          nodes: { n1: { id: 'other', type: 'demo.text', props: {} } },
        },
        at,
      }).code,
    ).toBe('INVALID_DOCUMENT')
    expect(refused(doc, { kind: 'insert', fragment: text('t1'), at })).toEqual({
      code: 'DUPLICATE_ID',
      id: 't1',
    })
    expect(
      refused(doc, {
        kind: 'insert',
        fragment: {
          rootId: 'k',
          nodes: {
            k: node('k', 'demo.columns', {}, ['k1', 'k1']),
            k1: node('k1', 'demo.column', {}, []),
          },
        },
        at,
      }),
    ).toEqual({ code: 'CYCLE', id: 'k1' })
  })

  it('refuses unknown types, invalid props and refused children', () => {
    const doc = sampleDoc()
    const at = { parentId: 's2', index: 0 }
    expect(
      refused(doc, {
        kind: 'insert',
        fragment: { rootId: 'n', nodes: { n: node('n', 'demo.nope', {}) } },
        at,
      }),
    ).toEqual({ code: 'UNKNOWN_TYPE', type: 'demo.nope' })
    const invalid = refused(doc, {
      kind: 'insert',
      fragment: {
        rootId: 'n',
        nodes: { n: node('n', 'demo.button', { label: '' }) },
      },
      at,
    })
    expect(invalid.code).toBe('INVALID_PROPS')
    expect(
      refused(doc, {
        kind: 'insert',
        fragment: {
          rootId: 'k',
          nodes: {
            k: node('k', 'demo.columns', {}, ['x']),
            x: node('x', 'demo.text', { text: 'a' }),
          },
        },
        at,
      }),
    ).toEqual({
      code: 'NOT_ACCEPTED',
      parentType: 'demo.columns',
      childType: 'demo.text',
    })
    expect(
      refused(doc, {
        kind: 'insert',
        fragment: {
          rootId: 'k',
          nodes: { k: node('k', 'demo.columns', {}, []) },
        },
        at,
      }),
    ).toEqual({ code: 'MIN_CHILDREN', parentType: 'demo.columns', min: 1 })
  })

  it('applies accepts, parents, max and unique at the target', () => {
    const doc = sampleDoc()
    expect(
      refused(doc, {
        kind: 'insert',
        fragment: text('n'),
        at: { parentId: 'root', index: 0 },
      }),
    ).toEqual({
      code: 'NOT_ACCEPTED',
      parentType: 'demo.page',
      childType: 'demo.text',
    })
    expect(
      refused(doc, {
        kind: 'insert',
        fragment: text('n'),
        at: { parentId: 'b1', index: 0 },
      }),
    ).toEqual({
      code: 'NOT_ACCEPTED',
      parentType: 'demo.button',
      childType: 'demo.text',
    })
    // demo.column accepts demo.text through a function but not demo.section.
    expect(
      refused(doc, {
        kind: 'insert',
        fragment: {
          rootId: 'n',
          nodes: { n: node('n', 'demo.section', {}, []) },
        },
        at: { parentId: 'c1', index: 0 },
      }).code,
    ).toBe('NOT_ACCEPTED')
    const full = apply(doc, {
      kind: 'insert',
      fragment: text('n1'),
      at: { parentId: 's1', index: 0 },
    }).doc
    expect(
      refused(full, {
        kind: 'insert',
        fragment: text('n2'),
        at: { parentId: 's1', index: 0 },
      }),
    ).toEqual({ code: 'MAX_CHILDREN', parentType: 'demo.section', max: 3 })
    expect(
      refused(doc, {
        kind: 'insert',
        fragment: {
          rootId: 'f2',
          nodes: { f2: node('f2', 'demo.footer', { address: 'x' }) },
        },
        at: { parentId: 'root', index: 3 },
      }),
    ).toEqual({ code: 'UNIQUE', type: 'demo.footer' })
  })

  it('refuses a fragment that holds a unique type twice', () => {
    const doc = createDocument(catalog)
    const removed = apply(
      doc,
      { kind: 'remove', id: doc.nodes.root.children?.[0] as string },
      true,
    ).doc
    const twice = defineCatalog({
      ...catalog,
      components: {
        ...catalog.components,
        'demo.page': {
          ...catalog.components['demo.page'],
          accepts: (type) => type === 'demo.footer' || type === 'demo.wrap',
        },
        'demo.wrap': {
          ...catalog.components['demo.section'],
          type: 'demo.wrap',
          parents: undefined,
          accepts: ['demo.footer'],
          maxChildren: undefined,
        },
        'demo.footer': {
          ...catalog.components['demo.footer'],
          parents: undefined,
        },
      },
    })
    const result = applyOp(
      removed,
      {
        kind: 'insert',
        fragment: {
          rootId: 'w',
          nodes: {
            w: node('w', 'demo.wrap', {}, ['f1', 'f2']),
            f1: node('f1', 'demo.footer', { address: 'a' }),
            f2: node('f2', 'demo.footer', { address: 'b' }),
          },
        },
        at: { parentId: 'root', index: 0 },
      },
      twice,
    )
    expect(result).toEqual({
      ok: false,
      error: { code: 'UNIQUE', type: 'demo.footer' },
    })
  })

  it('counts unique types against the batch so far', () => {
    const doc = sampleDoc()
    const footer = (id: string): CanvasOp => ({
      kind: 'insert',
      fragment: {
        rootId: id,
        nodes: { [id]: node(id, 'demo.footer', { address: 'x' }) },
      },
      at: { parentId: 'root', index: 9 },
    })
    const swapped = applyOp(
      doc,
      {
        kind: 'batch',
        ops: [
          { kind: 'update', id: 't1', set: { text: 'x' } },
          { kind: 'remove', id: 'footer' },
          footer('f2'),
        ],
      },
      catalog,
      { replay: true },
    )
    expect(swapped.ok && outline(swapped.value.doc)).toBe(
      'root(s1(t1,cols(c1(b1),c2)),s2(t2),f2)',
    )
    expect(
      refused(doc, {
        kind: 'batch',
        ops: [{ kind: 'update', id: 't1', set: { text: 'x' } }, footer('f2')],
      }),
    ).toEqual({ code: 'UNIQUE', type: 'demo.footer' })
  })

  it('reports an unknown parent type', () => {
    const doc = sampleDoc()
    doc.nodes.s2 = { ...doc.nodes.s2, type: 'demo.legacy' }
    expect(
      refused(doc, {
        kind: 'insert',
        fragment: text('n'),
        at: { parentId: 's2', index: 0 },
      }),
    ).toEqual({ code: 'UNKNOWN_TYPE', type: 'demo.legacy' })
  })
})

describe('remove', () => {
  it('removes a subtree and undo restores the same node objects', () => {
    const doc = sampleDoc()
    const { doc: next, inverse } = apply(doc, { kind: 'remove', id: 's1' })
    expect(outline(next)).toBe('root(s2(t2),footer)')
    for (const id of ['s1', 't1', 'cols', 'c1', 'c2', 'b1']) {
      expect(next.nodes[id]).toBeUndefined()
      expect(parentOf(next, id)).toBeNull()
    }
    expect(inverse).toMatchObject({
      kind: 'insert',
      at: { parentId: 'root', index: 0 },
    })
    const back = apply(next, inverse, true).doc
    expect(back).toEqual(doc)
    expect(back.nodes.b1).toBe(doc.nodes.b1)
    expect(parentOf(back, 'b1')).toBe('c1')
  })

  it('guards the root, missing nodes, locked and required nodes', () => {
    const doc = sampleDoc()
    expect(refused(doc, { kind: 'remove', id: 'root' })).toEqual({
      code: 'ROOT',
      op: 'remove',
    })
    expect(refused(doc, { kind: 'remove', id: 'nope' })).toEqual({
      code: 'NODE_NOT_FOUND',
      id: 'nope',
    })
    expect(refused(doc, { kind: 'remove', id: 'footer' })).toEqual({
      code: 'REQUIRED',
      type: 'demo.footer',
    })
    const locked = apply(doc, {
      kind: 'meta',
      id: 'b1',
      set: { locked: true },
    }).doc
    expect(refused(locked, { kind: 'remove', id: 's1' })).toEqual({
      code: 'LOCKED',
      id: 'b1',
    })
  })

  it('skips user guards when replaying history', () => {
    const doc = sampleDoc()
    const locked = apply(doc, {
      kind: 'meta',
      id: 'b1',
      set: { locked: true },
    }).doc
    expect(
      apply(locked, { kind: 'remove', id: 'b1' }, true).doc.nodes.b1,
    ).toBeUndefined()
    expect(
      apply(doc, { kind: 'remove', id: 'footer' }, true).doc.nodes.footer,
    ).toBeUndefined()
  })

  it('keeps the minimum children of the parent', () => {
    const doc = sampleDoc()
    const one = apply(doc, { kind: 'remove', id: 'c2' }).doc
    expect(refused(one, { kind: 'remove', id: 'c1' })).toEqual({
      code: 'MIN_CHILDREN',
      parentType: 'demo.columns',
      min: 1,
    })
  })
})

describe('move', () => {
  it('moves within the same parent using drop-line indexes', () => {
    const doc = apply(sampleDoc(), {
      kind: 'insert',
      fragment: text('t3'),
      at: { parentId: 's2', index: 1 },
    }).doc
    // s2: [t2, t3]; drop line after t3 (index 2) moves t2 to the end.
    const down = roundTrip(doc, {
      kind: 'move',
      id: 't2',
      to: { parentId: 's2', index: 2 },
    })
    expect(down.nodes.s2.children).toEqual(['t3', 't2'])
    const up = roundTrip(doc, {
      kind: 'move',
      id: 't3',
      to: { parentId: 's2', index: 0 },
    })
    expect(up.nodes.s2.children).toEqual(['t3', 't2'])
  })

  it('returns the same document for a move onto its own slot', () => {
    const doc = sampleDoc()
    for (const index of [0, 1]) {
      const { doc: next, inverse } = apply(doc, {
        kind: 'move',
        id: 't1',
        to: { parentId: 's1', index },
      })
      expect(next).toBe(doc)
      expect(apply(next, inverse).doc).toBe(doc)
    }
  })

  it('moves across parents and updates the parent index', () => {
    const doc = sampleDoc()
    expect(parentOf(doc, 't1')).toBe('s1')
    const next = roundTrip(doc, {
      kind: 'move',
      id: 't1',
      to: { parentId: 'c2', index: 0 },
    })
    expect(outline(next)).toBe('root(s1(cols(c1(b1),c2(t1))),s2(t2),footer)')
    expect(parentOf(next, 't1')).toBe('c2')
    expect(parentOf(doc, 't1')).toBe('s1')
  })

  it('moves into a container without a children array', () => {
    const doc = sampleDoc()
    doc.nodes.c2 = node('c2', 'demo.column', {})
    const next = apply(doc, {
      kind: 'move',
      id: 'b1',
      to: { parentId: 'c2', index: 0 },
    }).doc
    expect(next.nodes.c2.children).toEqual(['b1'])
  })

  it('guards root, missing nodes, lock, cycles and catalog rules', () => {
    const doc = sampleDoc()
    expect(
      refused(doc, {
        kind: 'move',
        id: 'root',
        to: { parentId: 's1', index: 0 },
      }),
    ).toEqual({
      code: 'ROOT',
      op: 'move',
    })
    expect(
      refused(doc, { kind: 'move', id: 'x', to: { parentId: 's1', index: 0 } })
        .code,
    ).toBe('NODE_NOT_FOUND')
    expect(
      refused(doc, { kind: 'move', id: 't1', to: { parentId: 'x', index: 0 } }),
    ).toEqual({
      code: 'NODE_NOT_FOUND',
      id: 'x',
    })
    expect(
      refused(doc, {
        kind: 'move',
        id: 's1',
        to: { parentId: 'c1', index: 0 },
      }),
    ).toEqual({
      code: 'CYCLE',
      id: 's1',
    })
    expect(
      refused(doc, {
        kind: 'move',
        id: 'cols',
        to: { parentId: 'cols', index: 0 },
      }).code,
    ).toBe('CYCLE')
    expect(
      refused(doc, {
        kind: 'move',
        id: 't1',
        to: { parentId: 'root', index: 0 },
      }).code,
    ).toBe('NOT_ACCEPTED')
    const locked = apply(doc, {
      kind: 'meta',
      id: 't1',
      set: { locked: true },
    }).doc
    expect(
      refused(locked, {
        kind: 'move',
        id: 't1',
        to: { parentId: 's2', index: 0 },
      }),
    ).toEqual({
      code: 'LOCKED',
      id: 't1',
    })
    expect(
      apply(
        locked,
        { kind: 'move', id: 't1', to: { parentId: 's2', index: 0 } },
        true,
      ).doc.nodes.s2.children,
    ).toEqual(['t1', 't2'])
  })

  it('checks max on the target and min on the source', () => {
    let doc = sampleDoc()
    doc = apply(doc, {
      kind: 'insert',
      fragment: text('n1'),
      at: { parentId: 's1', index: 0 },
    }).doc
    expect(
      refused(doc, { kind: 'move', id: 't2', to: { parentId: 's1', index: 0 } })
        .code,
    ).toBe('MAX_CHILDREN')
    // Reordering inside a full parent is fine.
    expect(
      apply(doc, { kind: 'move', id: 'n1', to: { parentId: 's1', index: 3 } })
        .doc.nodes.s1.children,
    ).toEqual(['t1', 'cols', 'n1'])
    const cols = apply(sampleDoc(), {
      kind: 'insert',
      fragment: fragmentForType(catalog, 'demo.columns') as CanvasFragment,
      at: { parentId: 's2', index: 0 },
    }).doc
    const oneCol = apply(cols, { kind: 'remove', id: 'c2' }).doc
    expect(
      refused(oneCol, {
        kind: 'move',
        id: 'c1',
        to: { parentId: cols.nodes.s2.children?.[0] as string, index: 0 },
      }),
    ).toEqual({
      code: 'MIN_CHILDREN',
      parentType: 'demo.columns',
      min: 1,
    })
  })
})

describe('update', () => {
  it('sets props by dot path and undo restores them exactly', () => {
    const doc = sampleDoc()
    const next = roundTrip(doc, {
      kind: 'update',
      id: 't1',
      set: {
        text: 'Oi',
        'style.color': '#fff',
        'style.padding.top': 8,
        items: ['a'],
      },
    })
    expect(next.nodes.t1.props).toEqual({
      text: 'Oi',
      style: { color: '#fff', padding: { top: 8 } },
      items: ['a'],
    })
    expect(next.nodes.t2).toBe(doc.nodes.t2)
  })

  it('handles overlapping paths and array items in the inverse', () => {
    const doc = apply(sampleDoc(), {
      kind: 'update',
      id: 't1',
      set: { items: ['a', 'b'], size: 3 },
    }).doc
    roundTrip(doc, {
      kind: 'update',
      id: 't1',
      set: { 'items.0': undefined, style: undefined },
    })
    roundTrip(doc, {
      kind: 'update',
      id: 't1',
      set: { style: {}, 'style.padding.left': 2 },
    })
    roundTrip(doc, {
      kind: 'update',
      id: 't1',
      set: { size: { base: 3, mobile: 2 } },
    })
  })

  it('returns the same document when nothing changes', () => {
    const doc = sampleDoc()
    const { doc: next, inverse } = apply(doc, {
      kind: 'update',
      id: 't1',
      set: { text: 'Olá' },
    })
    expect(next).toBe(doc)
    expect(inverse).toEqual({ kind: 'update', id: 't1', set: { text: 'Olá' } })
    expect(apply(doc, { kind: 'update', id: 't1', set: {} }).doc).toBe(doc)
  })

  it('validates paths, props and the node', () => {
    const doc = sampleDoc()
    expect(refused(doc, { kind: 'update', id: 'x', set: {} }).code).toBe(
      'NODE_NOT_FOUND',
    )
    expect(
      refused(doc, { kind: 'update', id: 't1', set: { '__proto__.x': 1 } }),
    ).toEqual({
      code: 'INVALID_PROPS',
      id: 't1',
      issues: ['__proto__.x: invalid path'],
    })
    const invalid = refused(doc, {
      kind: 'update',
      id: 'b1',
      set: { label: '' },
    })
    expect(invalid).toMatchObject({ code: 'INVALID_PROPS', id: 'b1' })
    expect((invalid as { issues: string[] }).issues[0]).toMatch(/^label: /)
    schemaSwitch.strictText = true
    expect(
      (
        refused(doc, { kind: 'update', id: 't1', set: { text: 'no' } }) as {
          issues: string[]
        }
      ).issues,
    ).toEqual(['props: texto recusado'])
    const legacy = sampleDoc()
    legacy.nodes.t1 = { ...legacy.nodes.t1, type: 'demo.legacy' }
    expect(
      refused(legacy, { kind: 'update', id: 't1', set: { text: 'x' } }),
    ).toEqual({
      code: 'UNKNOWN_TYPE',
      type: 'demo.legacy',
    })
  })
})

describe('meta', () => {
  it('sets and removes editor metadata, dropping an empty meta', () => {
    const doc = sampleDoc()
    const named = roundTrip(doc, {
      kind: 'meta',
      id: 't1',
      set: { name: 'Título', hidden: true },
    })
    expect(named.nodes.t1.meta).toEqual({ name: 'Título', hidden: true })
    const partial = apply(named, {
      kind: 'meta',
      id: 't1',
      set: { hidden: undefined },
    }).doc
    expect(partial.nodes.t1.meta).toEqual({ name: 'Título' })
    const cleared = apply(partial, {
      kind: 'meta',
      id: 't1',
      set: { name: undefined },
    }).doc
    expect(cleared.nodes.t1).toEqual(doc.nodes.t1)
    expect('meta' in cleared.nodes.t1).toBe(false)
  })

  it('returns the same document when nothing changes', () => {
    const doc = sampleDoc()
    expect(
      apply(doc, { kind: 'meta', id: 't1', set: { hidden: undefined } }).doc,
    ).toBe(doc)
    expect(refused(doc, { kind: 'meta', id: 'x', set: {} }).code).toBe(
      'NODE_NOT_FOUND',
    )
  })
})

describe('batch', () => {
  it('applies ops in order and undoes them as one step', () => {
    const doc = sampleDoc()
    const next = roundTrip(doc, {
      kind: 'batch',
      label: 'mix',
      ops: [
        {
          kind: 'insert',
          fragment: text('n1'),
          at: { parentId: 's2', index: 1 },
        },
        { kind: 'update', id: 'n1', set: { text: 'Editado' } },
        { kind: 'update', id: 'n1', set: { 'style.color': 'red' } },
        { kind: 'move', id: 't2', to: { parentId: 'c2', index: 0 } },
        { kind: 'remove', id: 'b1' },
        { kind: 'meta', id: 's1', set: { name: 'Topo' } },
      ],
    })
    expect(next.nodes.n1.props).toEqual({
      text: 'Editado',
      style: { color: 'red' },
    })
    expect(outline(next)).toBe('root(s1(t1,cols(c1,c2(t2))),s2(n1),footer)')
  })

  it('never mutates an inserted fragment when later ops patch its nodes', () => {
    const fragment = text('n1')
    const next = apply(sampleDoc(), {
      kind: 'batch',
      ops: [
        { kind: 'insert', fragment, at: { parentId: 's2', index: 0 } },
        { kind: 'update', id: 'n1', set: { text: 'A' } },
        { kind: 'remove', id: 'n1' },
        { kind: 'insert', fragment, at: { parentId: 's2', index: 0 } },
        { kind: 'update', id: 'n1', set: { text: 'B' } },
      ],
    }).doc
    expect(next.nodes.n1.props.text).toBe('B')
    expect(fragment.nodes.n1.props.text).toBe('Novo')
  })

  it('is all or nothing', () => {
    const doc = sampleDoc()
    const result = applyOp(
      doc,
      {
        kind: 'batch',
        ops: [
          { kind: 'update', id: 't1', set: { text: 'x' } },
          { kind: 'remove', id: 'root' },
        ],
      },
      catalog,
    )
    expect(result).toEqual({ ok: false, error: { code: 'ROOT', op: 'remove' } })
    expect(doc).toEqual(sampleDoc())
  })

  it('returns the same document for an empty batch', () => {
    const doc = sampleDoc()
    expect(apply(doc, { kind: 'batch', ops: [] })).toEqual({
      doc,
      inverse: { kind: 'batch', ops: [], label: undefined },
    })
  })
})

describe('parentOf and the derived index', () => {
  it('answers null for the root and unknown ids', () => {
    const doc = sampleDoc()
    expect(parentOf(doc, 'root')).toBeNull()
    expect(parentOf(doc, 'nope')).toBeNull()
    expect(parentOf(doc, 'b1')).toBe('c1')
  })

  it('stays correct across many derived documents (overlay flattening)', () => {
    let doc = sampleDoc()
    parentOf(doc, 'root')
    for (let i = 0; i < 40; i++) {
      const target = i % 2 === 0 ? 'c2' : 'c1'
      doc = apply(doc, {
        kind: 'move',
        id: 'b1',
        to: { parentId: target, index: 0 },
      }).doc
      doc = apply(doc, {
        kind: 'update',
        id: 'b1',
        set: { label: `x${i}` },
      }).doc
      expect(parentOf(doc, 'b1')).toBe(target)
      expect(parentOf(doc, 't1')).toBe('s1')
    }
    doc = apply(doc, { kind: 'remove', id: 'b1' }).doc
    for (let i = 0; i < 20; i++) {
      doc = apply(doc, {
        kind: 'move',
        id: 't2',
        to: { parentId: i % 2 ? 's2' : 'c1', index: 0 },
      }).doc
    }
    expect(parentOf(doc, 'b1')).toBeNull()
    expect(parentOf(doc, 't2')).toBe('s2')
  })

  it('builds lazily for documents derived from an unindexed one', () => {
    const doc = sampleDoc()
    const next = apply(doc, {
      kind: 'insert',
      fragment: text('n1'),
      at: { parentId: 's2', index: 0 },
    }).doc
    expect(parentOf(next, 'n1')).toBe('s2')
  })
})

describe('canDrop', () => {
  const doc = sampleDoc()

  it('accepts valid targets for a new node', () => {
    expect(canDrop(doc, catalog, 'demo.text', 's2')).toBe(true)
    expect(canDrop(doc, catalog, 'demo.text', 'c2')).toBe(true)
    expect(canDrop(doc, catalog, 'demo.section', 'root')).toBe(true)
  })

  it('refuses invalid targets for a new node', () => {
    expect(canDrop(doc, catalog, 'demo.text', 'root')).toBe(false)
    expect(canDrop(doc, catalog, 'demo.text', 'nope')).toBe(false)
    expect(canDrop(doc, catalog, 'demo.nope', 's2')).toBe(false)
    expect(canDrop(doc, catalog, 'demo.footer', 'root')).toBe(false)
    const full = apply(doc, {
      kind: 'insert',
      fragment: text('n1'),
      at: { parentId: 's1', index: 0 },
    }).doc
    expect(canDrop(full, catalog, 'demo.text', 's1')).toBe(false)
  })

  it('handles moving an existing node', () => {
    const full = apply(doc, {
      kind: 'insert',
      fragment: text('n1'),
      at: { parentId: 's1', index: 0 },
    }).doc
    expect(canDrop(full, catalog, 'demo.text', 's1', 'n1')).toBe(true)
    expect(canDrop(full, catalog, 'demo.text', 's1', 't2')).toBe(false)
    expect(canDrop(doc, catalog, 'demo.text', 'c2', 't1')).toBe(true)
    expect(canDrop(doc, catalog, 'demo.footer', 'root', 'footer')).toBe(true)
    expect(canDrop(doc, catalog, 'demo.section', 'c1', 's1')).toBe(false)
    expect(canDrop(doc, catalog, 'demo.text', 'c2', 'nope')).toBe(false)
    expect(canDrop(doc, catalog, 'demo.page', 's1', 'root')).toBe(false)
    expect(canDrop(doc, catalog, 'demo.columns', 's2', 'cols')).toBe(true)
    const oneCol = apply(doc, { kind: 'remove', id: 'c2' }).doc
    const twoCols = apply(oneCol, {
      kind: 'insert',
      fragment: fragmentForType(catalog, 'demo.columns') as CanvasFragment,
      at: { parentId: 's2', index: 0 },
    }).doc
    const other = twoCols.nodes.s2.children?.[0] as string
    expect(canDrop(twoCols, catalog, 'demo.column', other, 'c1')).toBe(false)
  })
})

describe('cloneFragment', () => {
  it('copies a document subtree with fresh ids', () => {
    const doc = sampleDoc()
    const fragment = cloneFragment({ doc, id: 's1' })
    const ids = Object.keys(fragment.nodes)
    expect(ids).toHaveLength(6)
    for (const id of ids) expect(doc.nodes[id]).toBeUndefined()
    const root = fragment.nodes[fragment.rootId]
    expect(root.type).toBe('demo.section')
    expect(root.children?.map((id) => fragment.nodes[id].type)).toEqual([
      'demo.text',
      'demo.columns',
    ])
    const t1 = fragment.nodes[root.children?.[0] as string]
    expect(t1.props).toEqual(doc.nodes.t1.props)
    expect(t1.props).not.toBe(doc.nodes.t1.props)
    expect(fragment.roots).toBeUndefined()
  })

  it('copies meta, multi-root fragments and drops dangling children', () => {
    const source: CanvasFragment = {
      rootId: 'a',
      roots: ['a', 'b'],
      nodes: {
        a: {
          ...node('a', 'demo.column', {}, ['x', 'ghost']),
          meta: { name: 'A' },
        },
        x: node('x', 'demo.text', { text: 'x' }),
        b: node('b', 'demo.text', { text: 'b' }),
      },
    }
    const fragment = cloneFragment(source)
    expect(fragment.roots).toHaveLength(2)
    expect(fragment.rootId).toBe(fragment.roots?.[0])
    const a = fragment.nodes[fragment.rootId]
    expect(a.meta).toEqual({ name: 'A' })
    expect(a.meta).not.toBe(source.nodes.a.meta)
    expect(a.children).toHaveLength(1)
    expect(Object.keys(fragment.nodes)).toHaveLength(3)
  })

  it('clones a shared node once when roots overlap', () => {
    const fragment = cloneFragment({
      rootId: 'a',
      roots: ['a', 'x'],
      nodes: {
        a: node('a', 'demo.column', {}, ['x']),
        x: node('x', 'demo.text', { text: 'x' }),
      },
    })
    expect(Object.keys(fragment.nodes)).toHaveLength(2)
  })

  it('throws for a missing source node', () => {
    expect(() => cloneFragment({ doc: sampleDoc(), id: 'nope' })).toThrow(
      /not found/,
    )
  })
})

describe('fragmentForType / createDocument', () => {
  it('builds palette fragments from templates or default props', () => {
    expect(fragmentForType(catalog, 'demo.nope')).toBeNull()
    const button = fragmentForType(catalog, 'demo.button') as CanvasFragment
    expect(button.nodes[button.rootId]).toEqual({
      id: button.rootId,
      type: 'demo.button',
      props: { label: 'Clique' },
    })
    const section = fragmentForType(catalog, 'demo.section') as CanvasFragment
    expect(section.nodes[section.rootId].children).toEqual([])
    const cols = fragmentForType(catalog, 'demo.columns') as CanvasFragment
    expect(cols.rootId).not.toBe('cols')
    expect(cols.nodes[cols.rootId].children).toHaveLength(2)
  })

  it('creates a valid document from the root template', () => {
    const doc = createDocument(catalog)
    expect(doc).toMatchObject({ catalog: 'demo', version: 1, rootId: 'root' })
    expect(doc.nodes.root.type).toBe('demo.page')
    const [footer] = doc.nodes.root.children ?? []
    expect(doc.nodes[footer].type).toBe('demo.footer')
    expect(validateDocument(doc, catalog).ok).toBe(true)
    expect(parentOf(doc, footer)).toBe('root')
  })

  it('creates a lone root without a template', () => {
    const plain = defineCatalog({
      ...catalog,
      rootType: 'demo.section',
      components: { ...catalog.components },
    })
    const doc = createDocument(plain)
    expect(doc.nodes).toEqual({
      root: { id: 'root', type: 'demo.section', props: {}, children: [] },
    })
  })

  it('throws when the root template starts with another type', () => {
    const broken = defineCatalog({
      ...catalog,
      components: {
        ...catalog.components,
        'demo.page': {
          ...catalog.components['demo.page'],
          template: () => text('x'),
        },
      },
    })
    expect(() => createDocument(broken)).toThrow(/root template/)
  })
})

describe('validateDocument', () => {
  it('accepts a valid document and returns it', () => {
    const doc = sampleDoc()
    expect(validateDocument(doc, catalog)).toEqual({ ok: true, value: doc })
  })

  it('rejects non-objects and bad headers', () => {
    expect(validateDocument(null, catalog)).toEqual({
      ok: false,
      error: [{ code: 'INVALID_DOCUMENT', reason: 'not an object' }],
    })
    const result = validateDocument(
      { catalog: 'email', version: 2, rootId: 'x', nodes: [] },
      catalog,
    )
    expect(result.ok ? [] : result.error.map((e) => e.code)).toEqual([
      'INVALID_DOCUMENT',
      'INVALID_DOCUMENT',
      'INVALID_DOCUMENT',
      'INVALID_DOCUMENT',
    ])
  })

  it('rejects malformed nodes', () => {
    const doc = sampleDoc() as unknown as { nodes: Record<string, unknown> }
    doc.nodes.t1 = { id: 'other', type: 'demo.text', props: {} }
    doc.nodes.t2 = { id: 't2', type: 'demo.text', props: [] }
    doc.nodes.b1 = { id: 'b1', type: 'demo.button', props: {}, meta: 'x' }
    doc.nodes.c2 = { id: 'c2', type: 'demo.column', props: {}, children: [1] }
    doc.nodes.c1 = 'nope'
    doc.nodes.s2 = { id: 's2', type: 3, props: {} }
    const result = validateDocument(doc, catalog)
    expect(result.ok ? 0 : result.error.length).toBe(6)
  })

  it('reports a missing root', () => {
    const doc = sampleDoc()
    const { root: _root, ...nodes } = doc.nodes
    expect(validateDocument({ ...doc, nodes }, catalog)).toEqual({
      ok: false,
      error: [{ code: 'NODE_NOT_FOUND', id: 'root' }],
    })
  })

  it('reports every tree and rule problem', () => {
    const doc = sampleDoc()
    doc.nodes.root = node('root', 'demo.section', {}, [
      's1',
      's2',
      'footer',
      'ghost',
      's2',
    ])
    doc.nodes.orphan = node('orphan', 'demo.text', { text: 'x' })
    doc.nodes.t2 = node('t2', 'demo.unknown', {})
    doc.nodes.b1 = node('b1', 'demo.button', { label: '' })
    doc.nodes.c2 = node('c2', 'demo.column', {}, ['extra'])
    doc.nodes.extra = node('extra', 'demo.footer', { address: 'x' })
    const result = validateDocument(doc, catalog)
    expect(result.ok).toBe(false)
    const codes = result.ok ? [] : result.error.map((e) => e.code)
    expect(codes).toEqual(
      expect.arrayContaining([
        'INVALID_DOCUMENT',
        'NODE_NOT_FOUND',
        'CYCLE',
        'UNKNOWN_TYPE',
        'INVALID_PROPS',
        'NOT_ACCEPTED',
        'MAX_CHILDREN',
        'UNIQUE',
      ]),
    )
  })

  it('reports leaf children, min children and missing required types', () => {
    const doc = sampleDoc()
    doc.nodes.root = node('root', 'demo.page', { title: 'x' }, ['s1', 's2'])
    delete doc.nodes.footer
    doc.nodes.t2 = node('t2', 'demo.text', { text: 'x' }, ['b1x'])
    doc.nodes.b1x = node('b1x', 'demo.button', { label: 'a' })
    doc.nodes.cols = node('cols', 'demo.columns', {}, [])
    delete doc.nodes.c1
    delete doc.nodes.c2
    delete doc.nodes.b1
    const result = validateDocument(doc, catalog)
    expect(result.ok ? [] : result.error).toEqual(
      expect.arrayContaining([
        {
          code: 'NOT_ACCEPTED',
          parentType: 'demo.text',
          childType: 'demo.button',
        },
        { code: 'MIN_CHILDREN', parentType: 'demo.columns', min: 1 },
        { code: 'REQUIRED', type: 'demo.footer' },
      ]),
    )
  })
})

describe('DocDraft', () => {
  it('answers undefined for the parent of a node removed in the draft', () => {
    const draft = new DocDraft(sampleDoc())
    expect(draft.parentOf('t2')).toBe('s2')
    draft.delete('t2')
    expect(draft.parentOf('t2')).toBeUndefined()
    expect(draft.get('t2')).toBeUndefined()
  })
})

describe('defineCatalog', () => {
  it('rejects references to unregistered types', () => {
    const page = catalog.components['demo.page']
    expect(() =>
      defineCatalog({
        ...catalog,
        components: {
          ...catalog.components,
          'demo.page': { ...page, accepts: ['demo.ghost'] },
        },
      }),
    ).toThrow(/unknown type demo.ghost/)
    expect(() =>
      defineCatalog({
        ...catalog,
        components: {
          ...catalog.components,
          'demo.page': { ...page, accepts: false, parents: ['demo.ghost'] },
        },
      }),
    ).toThrow(/unknown type demo.ghost/)
    expect(() => defineCatalog({ ...catalog, rootType: 'demo.ghost' })).toThrow(
      /root type/,
    )
  })
})

describe('resolveResponsive (re-export)', () => {
  it('resolves through ops', () => {
    expect(resolveResponsive({ base: 1, tablet: 2 }, 'mobile')).toBe(2)
  })
})
