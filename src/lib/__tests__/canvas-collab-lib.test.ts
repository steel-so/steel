import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createCanvasStore } from '@/src/lib/canvas/store'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  CANVAS_FLUSH,
  CANVAS_FLUSHED,
  canvasDocumentName,
  isCanvasDocumentName,
  parseCanvasDocumentName,
  parseCanvasStateless,
} from '@/src/lib/canvas-collab/names'
import {
  PRESENCE_COLORS,
  PRESENCE_FIELD,
  parsePresence,
  peersFrom,
  peopleFrom,
  presenceColor,
  shortName,
  textLocks,
} from '@/src/lib/canvas-collab/presence'
import {
  projectCanvas,
  readCanvas,
  sameNodes,
} from '@/src/lib/canvas-collab/project'
import {
  deepEqual,
  flatten,
  hasCanvas,
  mergeExternal,
  nodesOf,
  PATH_SEP,
  readHeader,
  readYNode,
  readYProps,
  seedYDoc,
  syncIds,
  syncProps,
  toYProps,
  writeNode,
} from '@/src/lib/canvas-collab/ydoc'
import { catalog, node, sampleDoc } from './canvas-fixture'

describe('canvas collab names', () => {
  it('builds and parses room names', () => {
    const name = canvasDocumentName('site-global', 'g1')
    expect(name).toBe('canvas.site-global.g1')
    expect(isCanvasDocumentName(name)).toBe(true)
    expect(parseCanvasDocumentName(name)).toEqual({
      kind: 'site-global',
      id: 'g1',
    })
    expect(isCanvasDocumentName('cl123')).toBe(false)
    expect(parseCanvasDocumentName('cl123')).toBeNull()
    expect(parseCanvasDocumentName('canvas.site-page')).toBeNull()
    expect(parseCanvasDocumentName('canvas.wiki.x')).toBeNull()
    expect(parseCanvasDocumentName('canvas.site-page.a/b')).toBeNull()
  })

  it('parses only well-formed stateless messages', () => {
    expect(
      parseCanvasStateless(
        JSON.stringify({ type: CANVAS_FLUSH, requestId: 'r1' }),
      ),
    ).toEqual({ type: CANVAS_FLUSH, requestId: 'r1' })
    expect(
      parseCanvasStateless(
        JSON.stringify({ type: CANVAS_FLUSHED, requestId: 'r1', ok: false }),
      ),
    ).toEqual({ type: CANVAS_FLUSHED, requestId: 'r1', ok: false })
    expect(parseCanvasStateless('{')).toBeNull()
    expect(parseCanvasStateless('null')).toBeNull()
    expect(parseCanvasStateless('{"type":"canvas.flush"}')).toBeNull()
    expect(
      parseCanvasStateless('{"type":"canvas.flushed","requestId":"r"}'),
    ).toBeNull()
    expect(parseCanvasStateless('{"type":"other","requestId":"r"}')).toBeNull()
  })
})

describe('canvas collab presence', () => {
  const state = (overrides: Record<string, unknown> = {}) => ({
    [PRESENCE_FIELD]: {
      user: { id: 'u1', name: 'Ana Souza', color: '#e5484d', image: null },
      selection: ['a', 'b'],
      editingText: 'a',
      breakpoint: 'mobile',
      ...overrides,
    },
  })

  it('gives each user a stable palette color', () => {
    expect(presenceColor('u1')).toBe(presenceColor('u1'))
    expect(PRESENCE_COLORS).toContain(presenceColor('outro'))
  })

  it('parses a valid presence and sanitizes the rest', () => {
    expect(parsePresence(3, state())).toEqual({
      clientId: 3,
      user: { id: 'u1', name: 'Ana Souza', color: '#e5484d', image: null },
      selection: ['a', 'b'],
      editingText: 'a',
      breakpoint: 'mobile',
    })
    const sloppy = parsePresence(
      4,
      state({
        user: { id: 'u2', name: 'Bia', color: 'red; x', image: 'https://i' },
        selection: ['ok', 42, ''],
        editingText: 5,
        breakpoint: 'watch',
      }),
    )
    expect(sloppy).toMatchObject({
      user: { color: presenceColor('u2'), image: 'https://i' },
      selection: ['ok'],
      editingText: null,
      breakpoint: null,
    })
    expect(parsePresence(5, state({ selection: 'x' }))?.selection).toEqual([])
    for (const raw of [
      null,
      {},
      { [PRESENCE_FIELD]: null },
      { [PRESENCE_FIELD]: { user: null } },
      state({ user: { id: '', name: 'x' } }),
      state({ user: { id: 'u', name: 'x'.repeat(200) } }),
    ]) {
      expect(parsePresence(1, raw)).toBeNull()
    }
  })

  it('lists other tabs, people and text locks', () => {
    const states = new Map<number, unknown>([
      [9, state()],
      [2, state({ editingText: 'a' })],
      [1, state()],
      [5, { other: true }],
    ])
    const peers = peersFrom(states, 1)
    expect(peers.map((peer) => peer.clientId)).toEqual([2, 9])
    expect(peopleFrom(peers)).toHaveLength(1)
    expect(textLocks(peers).get('a')?.clientId).toBe(2)
    expect(shortName('  Ana   Souza ')).toBe('Ana')
  })
})

describe('canvas collab ydoc helpers', () => {
  it('compares JSON-like values structurally', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true)
    expect(deepEqual([1], { 0: 1 })).toBe(false)
    expect(deepEqual([1, 2], [1])).toBe(false)
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false)
    expect(deepEqual(null, {})).toBe(false)
    expect(deepEqual(1, 2)).toBe(false)
  })

  it('flattens props to leaf paths and back', () => {
    const value = {
      text: 'x',
      empty: {},
      list: [1, { a: 1 }],
      style: { padding: { top: 1 }, color: '#000' },
      gone: undefined,
    }
    const flat = flatten(value)
    expect(flat.map(([path]) => path)).toEqual([
      'text',
      'empty',
      'list',
      `style${PATH_SEP}padding${PATH_SEP}top`,
      `style${PATH_SEP}color`,
    ])
    const ydoc = new Y.Doc()
    ydoc.getMap<unknown>('holder').set('props', toYProps(value))
    const map = ydoc.getMap<unknown>('holder').get('props') as Y.Map<unknown>
    expect(readYProps(map)).toEqual({
      text: 'x',
      empty: {},
      list: [1, { a: 1 }],
      style: { padding: { top: 1 }, color: '#000' },
    })
  })

  it('lets a deeper path win over a leaf written concurrently', () => {
    const ydoc = new Y.Doc()
    const map = ydoc.getMap<unknown>('props')
    map.set('style', 'flat')
    map.set(`style${PATH_SEP}color`, '#fff')
    map.set('box', {})
    map.set(`box${PATH_SEP}w`, 1)
    expect(readYProps(map)).toEqual({ style: { color: '#fff' }, box: { w: 1 } })
  })

  it('writes only the props paths that changed', () => {
    const ydoc = new Y.Doc()
    const map = ydoc.getMap<unknown>('props')
    const prev = { a: 1, style: { color: '#000', pad: { top: 1 } }, list: [1] }
    for (const [key, item] of flatten(prev)) map.set(key, item)
    map.set('a', 99) // someone else's newer value
    syncProps(map, prev, {
      a: 1,
      style: { color: '#f00', pad: { top: 1 } },
      list: [1, 2],
      fresh: { x: 1 },
    })
    expect(readYProps(map)).toEqual({
      a: 99,
      style: { color: '#f00', pad: { top: 1 } },
      list: [1, 2],
      fresh: { x: 1 },
    })
    // Object → leaf and leaf → object, and removals.
    const before = readYProps(map)
    syncProps(map, before, { a: 99, style: 'none', list: { n: 1 } })
    expect(readYProps(map)).toEqual({ a: 99, style: 'none', list: { n: 1 } })
  })

  it('skips undefined and structurally equal values', () => {
    const ydoc = new Y.Doc()
    const map = ydoc.getMap<unknown>('props')
    map.set('list', [1, 2])
    map.set('kept', 'remote')
    syncProps(
      map,
      { list: [1, 2], kept: 'a' },
      {
        list: [1, 2],
        kept: 'a',
        gone: undefined,
      },
    )
    expect(map.toJSON()).toEqual({ list: [1, 2], kept: 'remote' })
    // Without a baseline everything in `next` is written.
    syncProps(map, undefined, { list: [3] })
    expect(map.get('list')).toEqual([3])
  })

  it('creates nodes with meta and rewrites malformed ones whole', () => {
    const ydoc = new Y.Doc()
    const doc = sampleDoc()
    doc.nodes.t1 = { ...doc.nodes.t1, meta: { name: 'Título' } }
    seedYDoc(ydoc, doc)
    const nodes = nodesOf(ydoc)
    expect(readYNode('t1', nodes.get('t1'))?.meta).toEqual({ name: 'Título' })
    ;(nodes.get('t2') as Y.Map<unknown>).set('type', 42)
    expect(readYNode('t2', nodes.get('t2'))).toBeNull()
    writeNode(nodes, 't2', undefined, node('t2', 'demo.text', { text: 'ok' }))
    expect(readYNode('t2', nodes.get('t2'))).toEqual(
      node('t2', 'demo.text', { text: 'ok' }),
    )
  })

  it('rewrites id arrays with one splice', () => {
    const ydoc = new Y.Doc()
    const array = ydoc.getArray<string>('ids')
    array.push(['a', 'b', 'c', 'd'])
    syncIds(array, ['a', 'x', 'y', 'd'])
    expect(array.toArray()).toEqual(['a', 'x', 'y', 'd'])
    syncIds(array, ['a', 'd'])
    expect(array.toArray()).toEqual(['a', 'd'])
    syncIds(array, [])
    expect(array.toArray()).toEqual([])
  })

  it('reads malformed nodes as null and repairs a node in place', () => {
    const ydoc = new Y.Doc()
    seedYDoc(ydoc, sampleDoc())
    const nodes = nodesOf(ydoc)
    expect(readYNode('x', 'not a map')).toBeNull()
    expect(hasCanvas(ydoc)).toBe(true)
    expect(readHeader(new Y.Doc())).toBeNull()

    // A node whose props/children/meta were replaced by plain values.
    const t1 = nodes.get('t1') as Y.Map<unknown>
    t1.set('props', { text: 'plain' })
    t1.set('meta', { name: 'plain' })
    expect(readYNode('t1', t1)).toMatchObject({
      props: { text: 'plain' },
      meta: { name: 'plain' },
    })
    const s1 = nodes.get('s1') as Y.Map<unknown>
    s1.set('children', ['t1'])
    expect(readYNode('s1', s1)?.children).toEqual(['t1'])

    // writeNode rebuilds whatever is not a shared type.
    writeNode(nodes, 't1', undefined, node('t1', 'demo.text', { text: 'novo' }))
    writeNode(nodes, 's1', undefined, {
      ...node('s1', 'demo.section', {}, ['t1']),
      meta: { name: 'Seção' },
    })
    expect(readYNode('t1', nodes.get('t1'))).toEqual(
      node('t1', 'demo.text', { text: 'novo' }),
    )
    expect(readYNode('s1', nodes.get('s1'))?.meta).toEqual({ name: 'Seção' })
    writeNode(nodes, 's1', undefined, node('s1', 'demo.button', { label: 'x' }))
    expect(readYNode('s1', nodes.get('s1'))).toEqual(
      node('s1', 'demo.button', { label: 'x' }),
    )
    writeNode(nodes, 'missing', undefined, undefined)
  })

  it('merges only what changed between base and external', () => {
    const ydoc = new Y.Doc()
    const base = sampleDoc()
    seedYDoc(ydoc, base)
    const external: CanvasDocument = {
      ...base,
      nodes: {
        ...base.nodes,
        t2: node('t2', 'demo.text', { text: 'externo' }),
      },
    }
    expect(mergeExternal(ydoc, base, external, null)).toBe(1)
    expect(readCanvas(ydoc)?.doc.nodes.t2.props.text).toBe('externo')
  })
})

describe('projectCanvas', () => {
  const header = { catalog: 'demo', version: 1, rootId: 'root' }

  it('repairs the tree shape without a catalog', () => {
    const doc = sampleDoc()
    const raw: Record<string, ReturnType<typeof node>> = {
      ...doc.nodes,
      s1: node('s1', 'demo.section', {}, ['t1', 'cols', 'ghost', 't1']),
      s2: node('s2', 'demo.section', {}, ['t2', 't1']),
      orphan: node('orphan', 'demo.text', { text: 'x' }),
    }
    const projection = projectCanvas(header, (id) => raw[id])
    const out = projection?.doc as CanvasDocument
    expect(out.nodes.s1.children).toEqual(['t1', 'cols'])
    expect(out.nodes.s2.children).toEqual(['t2'])
    expect(out.nodes.orphan).toBeUndefined()
    expect(out.nodes.t2).toBe(raw.t2)
  })

  it('skips child ids whose node is gone from the Y document', () => {
    const ydoc = new Y.Doc()
    seedYDoc(ydoc, sampleDoc())
    nodesOf(ydoc).delete('t2')
    expect(readCanvas(ydoc)?.doc.nodes.s2.children).toEqual([])
  })

  it('returns null for a missing or wrong root', () => {
    expect(projectCanvas(header, () => undefined)).toBeNull()
    expect(
      projectCanvas(header, () => node('root', 'demo.text', { text: 'x' }), {
        catalog,
      }),
    ).toBeNull()
  })

  it('drops malformed nodes without a previous version', () => {
    const doc = sampleDoc()
    const projection = projectCanvas(
      header,
      (id) => (id === 't2' ? null : doc.nodes[id]),
      { catalog },
    )
    expect(projection?.rejected).toEqual(['t2'])
    expect(projection?.doc.nodes.s2.children).toEqual([])
  })

  it('tells whether two documents share every node object', () => {
    const doc = sampleDoc()
    const copy = { ...doc, nodes: { ...doc.nodes } }
    expect(sameNodes(doc, doc)).toBe(true)
    expect(sameNodes(doc, copy)).toBe(true)
    expect(
      sameNodes(doc, {
        ...doc,
        nodes: { ...doc.nodes, t1: { ...doc.nodes.t1 } },
      }),
    ).toBe(false)
    const { t1: _removed, ...fewer } = doc.nodes
    expect(sameNodes(doc, { ...doc, nodes: fewer })).toBe(false)
  })
})

describe('canvas store — co-editing hooks', () => {
  it('reports every document change with its source', () => {
    const store = createCanvasStore(catalog, sampleDoc())
    const sources: string[] = []
    const off = store.onChange((change) => sources.push(change.source))
    store.dispatch({ kind: 'update', id: 't1', set: { text: 'a' } })
    store.undo()
    store.redo()
    store.reset(sampleDoc())
    store.reset(store.getState().doc)
    const remote = { ...sampleDoc() }
    store.applyRemote(remote)
    store.applyRemote(remote)
    off()
    store.dispatch({ kind: 'update', id: 't1', set: { text: 'b' } })
    expect(sources).toEqual(['local', 'undo', 'redo', 'reset', 'remote'])
  })

  it('keeps history and repairs the selection on a remote change', () => {
    const store = createCanvasStore(catalog, sampleDoc())
    store.dispatch({ kind: 'update', id: 't1', set: { text: 'meu' } })
    store.select(['t2', 't1'])
    const doc = store.getState().doc
    const { t2: _gone, ...nodes } = doc.nodes
    store.applyRemote({
      ...doc,
      nodes: {
        ...nodes,
        s2: node('s2', 'demo.section', {}, []),
      },
    })
    expect(store.getState().selection).toEqual(['t1'])
    expect(store.getState().canUndo).toBe(true)
  })

  it('drops redo steps that no longer apply after a remote change', () => {
    const store = createCanvasStore(catalog, sampleDoc())
    store.dispatch({ kind: 'update', id: 't2', set: { text: 'x' } })
    store.undo()
    const doc = store.getState().doc
    const { t2: _gone, ...nodes } = doc.nodes
    store.applyRemote({
      ...doc,
      nodes: { ...nodes, s2: node('s2', 'demo.section', {}, []) },
    })
    expect(store.getState().canRedo).toBe(true)
    store.redo()
    expect(store.getState().canRedo).toBe(false)
    expect(store.getState().lastError).toMatchObject({ code: 'NODE_NOT_FOUND' })
  })

  it('refuses inline editing on guarded nodes', () => {
    const store = createCanvasStore(catalog, sampleDoc())
    store.setTextGuard((id) => id !== 't1')
    store.setEditingText('t1')
    expect(store.getState().editingText).toBeNull()
    store.setEditingText('t2')
    expect(store.getState().editingText).toBe('t2')
    store.setTextGuard(null)
    store.setEditingText('t1')
    expect(store.getState().editingText).toBe('t1')
  })

  it('keeps the old behavior for a failed undo without remote changes', () => {
    const store = createCanvasStore(catalog, sampleDoc())
    store.dispatch({ kind: 'update', id: 't2', set: { text: 'x' } })
    store.reset(store.getState().doc)
    expect(store.getState().canUndo).toBe(false)
  })
})
