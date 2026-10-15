import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { applyOp, type CanvasOp, getNode } from '@/src/lib/canvas/ops'
import { type CanvasStore, createCanvasStore } from '@/src/lib/canvas/store'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { bindCanvasStore } from '@/src/lib/canvas-collab/binding'
import { readCanvas } from '@/src/lib/canvas-collab/project'
import { nodesOf, seedYDoc, toYProps } from '@/src/lib/canvas-collab/ydoc'
import { catalog, node, outline, sampleDoc } from './canvas-fixture'

const NET = Symbol('net')

/** In-memory network: updates queue until `flush()`, so edits made before
 * a flush are concurrent. */
function network() {
  const docs: Y.Doc[] = []
  const queue: Array<[Y.Doc, Uint8Array]> = []
  return {
    add(doc: Y.Doc) {
      docs.push(doc)
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin !== NET) queue.push([doc, update])
      })
      // Joining: receive everything the others have.
      for (const other of docs) {
        if (other !== doc) Y.applyUpdate(doc, Y.encodeStateAsUpdate(other), NET)
      }
    },
    flush() {
      while (queue.length > 0) {
        const [from, update] = queue.shift() as [Y.Doc, Uint8Array]
        for (const doc of docs)
          if (doc !== from) Y.applyUpdate(doc, update, NET)
      }
    },
  }
}

interface Peer {
  ydoc: Y.Doc
  store: CanvasStore
  rejected: string[][]
}

function setup(peers = 2, initial: CanvasDocument = sampleDoc()) {
  const net = network()
  const server = new Y.Doc()
  seedYDoc(server, initial)
  net.add(server)
  const list: Peer[] = []
  for (let i = 0; i < peers; i++) {
    const ydoc = new Y.Doc()
    const store = createCanvasStore(catalog, initial)
    const rejected: string[][] = []
    const binding = bindCanvasStore(store, ydoc, {
      onRejected: (ids) => rejected.push(ids),
    })
    net.add(ydoc)
    binding.start()
    list.push({ ydoc, store, rejected })
  }
  return { net, server, peers: list }
}

const text = (store: CanvasStore, id: string) =>
  getNode(store.getState().doc, id)?.props

function plain(doc: CanvasDocument) {
  return JSON.parse(JSON.stringify({ ...doc, nodes: doc.nodes }))
}

function expectConverged(...peers: Peer[]) {
  const [first, ...rest] = peers
  const reference = plain(first.store.getState().doc)
  for (const peer of rest) {
    expect(plain(peer.store.getState().doc)).toEqual(reference)
  }
  for (const peer of peers) {
    const projected = readCanvas(peer.ydoc, { catalog })
    expect(plain(projected?.doc as CanvasDocument)).toEqual(reference)
  }
}

describe('bindCanvasStore — convergence', () => {
  it('seeds an empty Y document from the store on start', () => {
    const ydoc = new Y.Doc()
    const store = createCanvasStore(catalog, sampleDoc())
    const binding = bindCanvasStore(store, ydoc)
    expect(binding.started).toBe(false)
    binding.start()
    binding.start()
    expect(binding.started).toBe(true)
    expect(plain(readCanvas(ydoc)?.doc as CanvasDocument)).toEqual(
      plain(sampleDoc()),
    )
  })

  it('keeps concurrent edits of different props of the same node', () => {
    const { net, peers } = setup()
    const [a, b] = peers
    a.store.dispatch({
      kind: 'update',
      id: 't1',
      set: { 'style.color': '#f00' },
    })
    b.store.dispatch({ kind: 'update', id: 't1', set: { text: 'Oi' } })
    net.flush()
    expect(text(a.store, 't1')).toEqual({
      text: 'Oi',
      style: { color: '#f00' },
    })
    expectConverged(a, b)
  })

  it('keeps concurrent edits of sibling paths inside a nested object', () => {
    const { net, peers } = setup()
    const [a, b] = peers
    a.store.dispatch({
      kind: 'update',
      id: 't1',
      set: { 'style.padding.top': 4 },
    })
    b.store.dispatch({
      kind: 'update',
      id: 't1',
      set: { 'style.padding.left': 8 },
    })
    net.flush()
    expect(text(b.store, 't1')).toMatchObject({
      style: { color: '#000', padding: { top: 4, left: 8 } },
    })
    expectConverged(a, b)
  })

  it('resolves the same prop edited by both to one value everywhere', () => {
    const { net, peers } = setup()
    const [a, b] = peers
    a.store.dispatch({ kind: 'update', id: 't2', set: { text: 'A' } })
    b.store.dispatch({ kind: 'update', id: 't2', set: { text: 'B' } })
    net.flush()
    expectConverged(a, b)
  })

  it('places a node moved to two parents at once only once', () => {
    const { net, peers } = setup()
    const [a, b] = peers
    a.store.dispatch({
      kind: 'move',
      id: 'b1',
      to: { parentId: 'c2', index: 0 },
    })
    b.store.dispatch({
      kind: 'move',
      id: 'b1',
      to: { parentId: 's2', index: 0 },
    })
    net.flush()
    const doc = a.store.getState().doc
    const parents = Object.values(doc.nodes).filter((n) =>
      n.children?.includes('b1'),
    )
    expect(parents).toHaveLength(1)
    expectConverged(a, b)
  })

  it('drops an insert into a subtree removed concurrently', () => {
    const { net, peers } = setup()
    const [a, b] = peers
    a.store.insertFragment(
      { rootId: 'x', nodes: { x: node('x', 'demo.text', { text: 'novo' }) } },
      { parentId: 's2', index: 0 },
    )
    b.store.remove(['s2'])
    net.flush()
    expect(getNode(a.store.getState().doc, 's2')).toBeUndefined()
    expectConverged(a, b)
  })

  it('caps concurrent inserts at the parent maxChildren', () => {
    const { net, peers } = setup()
    const [a, b] = peers
    // s1 has 2 children, max 3: each side adds one.
    a.store.insertType('demo.text', { parentId: 's1', index: 0 })
    b.store.insertType('demo.button', { parentId: 's1', index: 2 })
    net.flush()
    const s1 = getNode(a.store.getState().doc, 's1')
    expect(s1?.children).toHaveLength(3)
    expect(a.rejected.flat().length + b.rejected.flat().length).toBeGreaterThan(
      0,
    )
    expectConverged(a, b)
  })

  it('converges after random concurrent edits on three peers', () => {
    const { net, peers } = setup(3)
    let seed = 7
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]
    for (let round = 0; round < 60; round++) {
      for (const peer of peers) {
        const doc = peer.store.getState().doc
        const ids = Object.keys(doc.nodes).filter((id) => id !== 'root')
        const texts = ids.filter((id) => doc.nodes[id].type === 'demo.text')
        const sections = ids.filter(
          (id) => doc.nodes[id].type === 'demo.section',
        )
        const choice = random()
        if (choice < 0.3 && texts.length > 0) {
          peer.store.dispatch({
            kind: 'update',
            id: pick(texts),
            set: { text: `t${round}`, 'style.color': pick(['#111', '#222']) },
          })
        } else if (choice < 0.5 && sections.length > 0) {
          peer.store.insertType('demo.text', {
            parentId: pick(sections),
            index: 0,
          })
        } else if (choice < 0.65 && texts.length > 0 && sections.length > 0) {
          peer.store.dispatch({
            kind: 'move',
            id: pick(texts),
            to: { parentId: pick(sections), index: 0 },
          })
        } else if (choice < 0.75 && texts.length > 1) {
          peer.store.remove([pick(texts)])
        } else if (choice < 0.85) {
          peer.store.undo()
        } else if (sections.length < 3) {
          peer.store.insertType('demo.section', { parentId: 'root', index: 0 })
        } else {
          peer.store.redo()
        }
      }
      if (round % 3 === 2) net.flush()
    }
    net.flush()
    expectConverged(...peers)
  })
})

describe('bindCanvasStore — history', () => {
  it('undoes only the local user’s change', () => {
    const { net, peers } = setup()
    const [a, b] = peers
    a.store.dispatch({ kind: 'update', id: 't1', set: { text: 'de A' } })
    net.flush()
    b.store.dispatch({ kind: 'update', id: 't2', set: { text: 'de B' } })
    net.flush()
    expect(a.store.getState().canUndo).toBe(true)
    a.store.undo()
    net.flush()
    expect(text(b.store, 't1')).toMatchObject({ text: 'Olá' })
    expect(text(b.store, 't2')).toEqual({ text: 'de B' })
    expect(a.store.getState().canUndo).toBe(false)
    a.store.redo()
    net.flush()
    expect(text(b.store, 't1')).toMatchObject({ text: 'de A' })
    expectConverged(a, b)
  })

  it('does not undo a remote change applied after a local one', () => {
    const { net, peers } = setup()
    const [a, b] = peers
    a.store.dispatch({
      kind: 'update',
      id: 't1',
      set: { 'style.color': '#f00' },
    })
    net.flush()
    b.store.dispatch({ kind: 'update', id: 't1', set: { text: 'B' } })
    net.flush()
    a.store.undo()
    net.flush()
    expect(text(a.store, 't1')).toEqual({ text: 'B', style: { color: '#000' } })
    expectConverged(a, b)
  })

  it('drops a local step whose node was removed by someone else', () => {
    const { net, peers } = setup()
    const [a, b] = peers
    a.store.dispatch({ kind: 'update', id: 't1', set: { text: 'antes' } })
    a.store.dispatch({ kind: 'update', id: 't2', set: { text: 'x' } })
    net.flush()
    b.store.remove(['s2'])
    net.flush()
    a.store.undo() // t2 is gone: the step is dropped
    expect(a.store.getState().lastError).toMatchObject({
      code: 'NODE_NOT_FOUND',
    })
    expect(a.store.getState().canUndo).toBe(true)
    a.store.undo() // the step below still works
    net.flush()
    expect(text(b.store, 't1')).toMatchObject({ text: 'Olá' })
    expectConverged(a, b)
  })

  it('propagates a reset (restored version) to everyone', () => {
    const { net, peers } = setup()
    const [a, b] = peers
    const restored = sampleDoc()
    restored.nodes.t2 = node('t2', 'demo.text', { text: 'restaurado' })
    a.store.reset(restored)
    net.flush()
    expect(text(b.store, 't2')).toEqual({ text: 'restaurado' })
    expectConverged(a, b)
  })
})

describe('bindCanvasStore — remote validation', () => {
  it('rejects invalid props from a remote update and keeps the last good node', () => {
    const { net, server, peers } = setup()
    const [a] = peers
    server.transact(() => {
      const t1 = nodesOf(server).get('t1') as Y.Map<unknown>
      ;(t1.get('props') as Y.Map<unknown>).set('text', 42)
    })
    net.flush()
    expect(text(a.store, 't1')).toMatchObject({ text: 'Olá' })
    expect(a.rejected).toContainEqual(['t1'])
  })

  it('rejects nodes of unknown types and malformed nodes', () => {
    const { net, server, peers } = setup()
    const [a] = peers
    server.transact(() => {
      const nodes = nodesOf(server)
      const evil = new Y.Map<unknown>()
      evil.set('type', 'demo.script')
      evil.set('props', toYProps({ code: 'alert(1)' }))
      nodes.set('evil', evil)
      const broken = new Y.Map<unknown>()
      broken.set('type', 'demo.text')
      broken.set('props', 'not an object')
      nodes.set('broken', broken)
      const s2 = nodes.get('s2') as Y.Map<unknown>
      ;(s2.get('children') as Y.Array<string>).push(['evil', 'broken'])
    })
    net.flush()
    expect(getNode(a.store.getState().doc, 'evil')).toBeUndefined()
    expect(getNode(a.store.getState().doc, 'broken')).toBeUndefined()
    expect(a.rejected.flat()).toEqual(
      expect.arrayContaining(['evil', 'broken']),
    )
  })

  it('refuses a child the parent does not accept', () => {
    const { net, server, peers } = setup()
    const [a] = peers
    server.transact(() => {
      const root = nodesOf(server).get('root') as Y.Map<unknown>
      ;(root.get('children') as Y.Array<string>).push(['b1'])
      const c1 = nodesOf(server).get('c1') as Y.Map<unknown>
      ;(c1.get('children') as Y.Array<string>).delete(0, 1)
    })
    net.flush()
    expect(getNode(a.store.getState().doc, 'root')?.children).not.toContain(
      'b1',
    )
    expect(a.rejected.flat()).toContain('b1')
  })

  it('ignores an update that breaks the root', () => {
    const { net, server, peers } = setup()
    const [a] = peers
    const before = a.store.getState().doc
    server.transact(() => {
      const root = nodesOf(server).get('root') as Y.Map<unknown>
      root.set('type', 'demo.text')
    })
    net.flush()
    expect(a.store.getState().doc).toBe(before)
    expect(a.rejected).toContainEqual(['root'])
  })
})

describe('bindCanvasStore — lifecycle', () => {
  it('merges edits made before the sync without reverting newer remote ones', () => {
    const net = network()
    const server = new Y.Doc()
    seedYDoc(server, sampleDoc())
    net.add(server)
    // Someone else changed t2 on the server after we loaded the page.
    server.transact(() => {
      const t2 = nodesOf(server).get('t2') as Y.Map<unknown>
      ;(t2.get('props') as Y.Map<unknown>).set('text', 'remoto')
    })
    const ydoc = new Y.Doc()
    const store = createCanvasStore(catalog, sampleDoc())
    const binding = bindCanvasStore(store, ydoc)
    store.dispatch({ kind: 'update', id: 't1', set: { text: 'local' } })
    net.add(ydoc)
    binding.start()
    net.flush()
    expect(text(store, 't1')).toMatchObject({ text: 'local' })
    expect(text(store, 't2')).toEqual({ text: 'remoto' })
    expect(plain(readCanvas(server)?.doc as CanvasDocument)).toEqual(
      plain(store.getState().doc),
    )
  })

  it('a read-only session receives changes but sends none', () => {
    const { net, peers } = setup()
    const [a, b] = peers
    const ydoc = new Y.Doc()
    const store = createCanvasStore(catalog, sampleDoc())
    const binding = bindCanvasStore(store, ydoc)
    binding.setReadOnly(true)
    net.add(ydoc)
    binding.start()
    store.dispatch({ kind: 'update', id: 't1', set: { text: 'ignorado' } })
    a.store.dispatch({ kind: 'update', id: 't2', set: { text: 'visto' } })
    net.flush()
    expect(text(b.store, 't1')).toMatchObject({ text: 'Olá' })
    expect(text(store, 't2')).toEqual({ text: 'visto' })
  })

  it('a read-only session does not seed an empty document', () => {
    const ydoc = new Y.Doc()
    const store = createCanvasStore(catalog, sampleDoc())
    const binding = bindCanvasStore(store, ydoc)
    binding.setReadOnly(true)
    binding.start()
    expect(readCanvas(ydoc)).toBeNull()
  })

  it('stops mirroring after dispose', () => {
    const { net, peers } = setup()
    const [a, b] = peers
    const ydoc = new Y.Doc()
    const store = createCanvasStore(catalog, sampleDoc())
    const binding = bindCanvasStore(store, ydoc)
    net.add(ydoc)
    binding.start()
    binding.dispose()
    store.dispatch({ kind: 'update', id: 't1', set: { text: 'solto' } })
    a.store.dispatch({ kind: 'update', id: 't2', set: { text: 'novo' } })
    net.flush()
    expect(text(b.store, 't1')).toMatchObject({ text: 'Olá' })
    expect(text(store, 't2')).toEqual({ text: 'Tchau' })
  })

  it('writes nothing for an op that changes nothing', () => {
    const ydoc = new Y.Doc()
    const store = createCanvasStore(catalog, sampleDoc())
    bindCanvasStore(store, ydoc).start()
    const spy = vi.fn()
    ydoc.on('update', spy)
    store.dispatch({ kind: 'update', id: 't2', set: { text: 'Tchau' } })
    store.select('t1')
    expect(spy).not.toHaveBeenCalled()
  })

  it('maps every op kind, including batches and meta', () => {
    const { net, peers } = setup()
    const [a, b] = peers
    const ops: CanvasOp[] = [
      { kind: 'meta', id: 't1', set: { name: 'Título', locked: true } },
      {
        kind: 'batch',
        ops: [
          { kind: 'move', id: 't2', to: { parentId: 's1', index: 0 } },
          { kind: 'update', id: 'cols', set: { gap: 16 } },
        ],
      },
      { kind: 'meta', id: 't1', set: { locked: undefined } },
    ]
    for (const op of ops) expect(a.store.dispatch(op)).toBe(true)
    net.flush()
    expect(outline(b.store.getState().doc)).toBe(
      outline(a.store.getState().doc),
    )
    expect(getNode(b.store.getState().doc, 't1')?.meta).toEqual({
      name: 'Título',
    })
    expectConverged(a, b)
  })

  it('removes a node’s children list and meta when they go away', () => {
    const { net, peers } = setup()
    const [a, b] = peers
    const doc = a.store.getState().doc
    const next = applyOp(
      doc,
      { kind: 'meta', id: 'b1', set: { name: 'x' } },
      catalog,
    )
    if (!next.ok) throw new Error('op failed')
    a.store.reset(next.value.doc)
    net.flush()
    const changed = { ...sampleDoc() }
    a.store.reset(changed)
    net.flush()
    expect(getNode(b.store.getState().doc, 'b1')?.meta).toBeUndefined()
    expectConverged(a, b)
  })
})
