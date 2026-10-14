import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parentOf } from '@/src/lib/canvas/ops'
import { defineCatalog } from '@/src/lib/canvas/registry'
import {
  COALESCE_MS,
  createCanvasStore,
  HISTORY_LIMIT,
  ZOOM_MAX,
  ZOOM_MIN,
} from '@/src/lib/canvas/store'
import {
  catalog,
  node,
  outline,
  sampleDoc,
  schemaSwitch,
} from './canvas-fixture'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-14T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  schemaSwitch.strictText = false
})

function setup() {
  const store = createCanvasStore(catalog, sampleDoc())
  const listener = vi.fn()
  store.subscribe(listener)
  return { store, listener }
}

describe('initial state and subscriptions', () => {
  it('starts clean on the first catalog breakpoint', () => {
    const { store } = setup()
    expect(store.catalog).toBe(catalog)
    expect(store.getState()).toMatchObject({
      selection: [],
      hovered: null,
      editingText: null,
      breakpoint: 'base',
      zoom: 1,
      canUndo: false,
      canRedo: false,
      dirty: false,
      lastError: null,
    })
  })

  it('falls back to base when the catalog lists no breakpoints', () => {
    const bare = defineCatalog({ ...catalog, breakpoints: [] })
    expect(createCanvasStore(bare, sampleDoc()).getState().breakpoint).toBe(
      'base',
    )
  })

  it('notifies only on real changes and unsubscribes', () => {
    const { store, listener } = setup()
    store.select('t1')
    store.select(['t1'])
    expect(listener).toHaveBeenCalledTimes(1)
    const other = vi.fn()
    const off = store.subscribe(other)
    off()
    store.select(null)
    expect(other).not.toHaveBeenCalled()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('dispatch, undo and redo', () => {
  it('records steps and travels both ways', () => {
    const { store } = setup()
    const original = store.getState().doc
    expect(store.dispatch({ kind: 'remove', id: 't2' })).toBe(true)
    expect(store.getState()).toMatchObject({
      canUndo: true,
      canRedo: false,
      dirty: true,
    })
    store.undo()
    expect(store.getState().doc).toEqual(original)
    expect(store.getState()).toMatchObject({
      canUndo: false,
      canRedo: true,
      dirty: false,
    })
    store.redo()
    expect(store.getState().doc.nodes.t2).toBeUndefined()
    expect(store.getState().dirty).toBe(true)
    store.undo()
    store.redo()
    store.undo()
    expect(store.getState().doc).toEqual(original)
  })

  it('does nothing when there is nothing to undo or redo', () => {
    const { store, listener } = setup()
    store.undo()
    store.redo()
    expect(listener).not.toHaveBeenCalled()
  })

  it('reports refused ops and clears the error on success', () => {
    const { store } = setup()
    expect(store.dispatch({ kind: 'remove', id: 'root' })).toBe(false)
    expect(store.getState().lastError).toEqual({ code: 'ROOT', op: 'remove' })
    expect(store.getState().canUndo).toBe(false)
    store.dispatch({ kind: 'update', id: 't1', set: { text: 'Olá' } })
    expect(store.getState().lastError).toBeNull()
    expect(store.getState().canUndo).toBe(false)
    store.dispatch({ kind: 'remove', id: 'root' })
    store.dispatch({ kind: 'update', id: 't1', set: { text: 'x' } })
    expect(store.getState().lastError).toBeNull()
  })

  it('drops the redo stack on a new step', () => {
    const { store } = setup()
    store.dispatch({ kind: 'remove', id: 't2' })
    store.undo()
    store.dispatch({ kind: 'remove', id: 't1' })
    expect(store.getState().canRedo).toBe(false)
  })

  it(`keeps at most ${HISTORY_LIMIT} steps`, () => {
    const { store } = setup()
    for (let i = 0; i <= HISTORY_LIMIT; i++) {
      store.dispatch(
        { kind: 'update', id: 't1', set: { text: `v${i}` } },
        { coalesce: false },
      )
    }
    let undone = 0
    while (store.getState().canUndo) {
      store.undo()
      undone++
    }
    expect(undone).toBe(HISTORY_LIMIT)
    expect(store.getState().doc.nodes.t1.props.text).toBe('v0')
    // The oldest step was dropped, so this is not the saved state.
    expect(store.getState().dirty).toBe(true)
  })

  it('keeps the entry and reports when history can no longer be replayed', () => {
    const { store } = setup()
    store.dispatch({ kind: 'update', id: 't1', set: { text: 'novo' } })
    schemaSwitch.strictText = true
    store.undo()
    expect(store.getState().lastError?.code).toBe('INVALID_PROPS')
    expect(store.getState().canUndo).toBe(true)
    schemaSwitch.strictText = false
    store.undo()
    schemaSwitch.strictText = true
    store.redo()
    expect(store.getState().lastError?.code).toBe('INVALID_PROPS')
    expect(store.getState().canRedo).toBe(true)
  })

  it('undoes past a lock and a required insert (replay mode)', () => {
    const { store } = setup()
    store.dispatch({ kind: 'move', id: 't2', to: { parentId: 'c2', index: 0 } })
    store.dispatch(
      { kind: 'meta', id: 't2', set: { locked: true } },
      { label: 'lock' },
    )
    store.undo()
    store.undo()
    expect(outline(store.getState().doc)).toBe(outline(sampleDoc()))
  })
})

describe('coalescing', () => {
  it('merges updates on the same node and paths within the window', () => {
    const { store } = setup()
    store.dispatch({ kind: 'update', id: 't1', set: { text: 'O' } })
    vi.advanceTimersByTime(COALESCE_MS)
    store.dispatch({ kind: 'update', id: 't1', set: { text: 'Oi' } })
    vi.advanceTimersByTime(COALESCE_MS - 1)
    store.dispatch({ kind: 'update', id: 't1', set: { text: 'Oi!' } })
    store.undo()
    expect(store.getState().doc.nodes.t1.props.text).toBe('Olá')
    expect(store.getState().canUndo).toBe(false)
    store.redo()
    expect(store.getState().doc.nodes.t1.props.text).toBe('Oi!')
  })

  it('starts a new step after the window, on other paths or when asked', () => {
    const { store } = setup()
    store.dispatch({ kind: 'update', id: 't1', set: { text: 'a' } })
    vi.advanceTimersByTime(COALESCE_MS + 1)
    store.dispatch({ kind: 'update', id: 't1', set: { text: 'b' } })
    store.dispatch({ kind: 'update', id: 't1', set: { 'style.color': 'red' } })
    store.dispatch({ kind: 'update', id: 't2', set: { 'style.color': 'red' } })
    store.dispatch(
      { kind: 'update', id: 't2', set: { 'style.color': 'blue' } },
      { coalesce: false },
    )
    store.dispatch({ kind: 'meta', id: 't2', set: { name: 'x' } })
    store.dispatch({
      kind: 'update',
      id: 't2',
      set: { 'style.color': 'green' },
    })
    let steps = 0
    while (store.getState().canUndo) {
      store.undo()
      steps++
    }
    expect(steps).toBe(7)
  })

  it('never merges across an undo', () => {
    const { store } = setup()
    store.dispatch({ kind: 'update', id: 't1', set: { text: 'a' } })
    store.dispatch({ kind: 'update', id: 't2', set: { text: 'b' } })
    store.undo()
    store.dispatch({ kind: 'update', id: 't1', set: { text: 'c' } })
    store.undo()
    expect(store.getState().doc.nodes.t1.props.text).toBe('a')
  })
})

describe('dirty tracking', () => {
  it('follows the saved point through undo and redo', () => {
    const { store } = setup()
    store.dispatch({ kind: 'remove', id: 't2' })
    store.markSaved()
    expect(store.getState().dirty).toBe(false)
    store.undo()
    expect(store.getState().dirty).toBe(true)
    store.redo()
    expect(store.getState().dirty).toBe(false)
  })

  it('marks a snapshot saved while later edits stay dirty', () => {
    const { store } = setup()
    store.dispatch({ kind: 'update', id: 't1', set: { text: 'a' } })
    const sent = store.getState().doc
    store.dispatch({ kind: 'update', id: 't1', set: { text: 'ab' } })
    store.markSaved(sent)
    expect(store.getState().dirty).toBe(true)
    // The coalesced step went past the snapshot; undo returns before it.
    store.undo()
    expect(store.getState().dirty).toBe(true)
    store.redo()
    store.markSaved(store.getState().doc)
    expect(store.getState().dirty).toBe(false)
  })

  it('does not coalesce across a save', () => {
    const { store } = setup()
    store.dispatch({ kind: 'update', id: 't1', set: { text: 'a' } })
    store.markSaved()
    store.dispatch({ kind: 'update', id: 't1', set: { text: 'ab' } })
    store.undo()
    expect(store.getState()).toMatchObject({ dirty: false, canUndo: true })
  })

  it('treats an unknown snapshot as never saved', () => {
    const { store } = setup()
    store.markSaved(sampleDoc())
    expect(store.getState().dirty).toBe(true)
  })
})

describe('selection and view state', () => {
  it('selects existing ids only, deduplicated', () => {
    const { store } = setup()
    store.select(['t1', 'nope', 't1', 't2'])
    expect(store.getState().selection).toEqual(['t1', 't2'])
    store.select('nope')
    expect(store.getState().selection).toEqual([])
  })

  it('repairs selection, hover and inline editing after a removal', () => {
    const { store } = setup()
    store.select(['t1', 't2'])
    store.hover('t2')
    store.setEditingText('t2')
    store.dispatch({ kind: 'remove', id: 't2' })
    expect(store.getState()).toMatchObject({
      selection: ['t1'],
      hovered: null,
      editingText: null,
    })
  })

  it('keeps the selection array identity when it is still valid', () => {
    const { store } = setup()
    store.hover('t1')
    store.setEditingText('t1')
    store.select(['t1'])
    const before = store.getState().selection
    store.dispatch({ kind: 'update', id: 't1', set: { text: 'x' } })
    expect(store.getState().selection).toBe(before)
    expect(store.getState()).toMatchObject({ hovered: 't1', editingText: 't1' })
  })

  it('restores the selection on undo and redo', () => {
    const { store } = setup()
    store.select('t2')
    store.dispatch({ kind: 'remove', id: 't2' })
    store.select('t1')
    store.undo()
    expect(store.getState().selection).toEqual(['t2'])
    store.redo()
    expect(store.getState().selection).toEqual(['t1'])
  })

  it('ignores hover and inline editing of missing nodes', () => {
    const { store } = setup()
    store.hover('t1')
    store.hover('nope')
    expect(store.getState().hovered).toBeNull()
    store.hover('t1')
    store.hover(null)
    expect(store.getState().hovered).toBeNull()
    store.setEditingText('t1')
    expect(store.getState().editingText).toBe('t1')
    store.setEditingText('nope')
    expect(store.getState().editingText).toBeNull()
    store.setEditingText(null)
  })

  it('switches only to catalog breakpoints and clamps zoom', () => {
    const emailLike = defineCatalog({
      ...catalog,
      breakpoints: ['base', 'mobile'],
    })
    const store = createCanvasStore(emailLike, sampleDoc())
    store.setBreakpoint('mobile')
    store.setBreakpoint('tablet')
    expect(store.getState().breakpoint).toBe('mobile')
    store.setZoom(10)
    expect(store.getState().zoom).toBe(ZOOM_MAX)
    store.setZoom(0)
    expect(store.getState().zoom).toBe(ZOOM_MIN)
    store.setZoom(Number.NaN)
    expect(store.getState().zoom).toBe(ZOOM_MIN)
    store.setZoom(1.5)
    expect(store.getState().zoom).toBe(1.5)
  })
})

describe('helpers', () => {
  it('inserts a palette type and selects it', () => {
    const { store } = setup()
    const id = store.insertType('demo.columns', { parentId: 's2', index: 1 })
    const { doc, selection } = store.getState()
    expect(selection).toEqual([id])
    expect(doc.nodes[id as string].children).toHaveLength(2)
    expect(parentOf(doc, id as string)).toBe('s2')
    store.undo()
    expect(store.getState().doc.nodes[id as string]).toBeUndefined()
  })

  it('reports unknown and refused palette types', () => {
    const { store } = setup()
    expect(
      store.insertType('demo.nope', { parentId: 's2', index: 0 }),
    ).toBeNull()
    expect(store.getState().lastError).toEqual({
      code: 'UNKNOWN_TYPE',
      type: 'demo.nope',
    })
    expect(
      store.insertType('demo.text', { parentId: 'root', index: 0 }),
    ).toBeNull()
    expect(store.getState().lastError?.code).toBe('NOT_ACCEPTED')
  })

  it('inserts fragments with fresh ids, including multi-root ones', () => {
    const { store } = setup()
    const fragment = {
      rootId: 'a',
      roots: ['a', 'b'],
      nodes: {
        a: node('a', 'demo.text', { text: 'A' }),
        b: node('b', 'demo.button', { label: 'B' }),
      },
    }
    const first = store.insertFragment(fragment, { parentId: 'c2', index: 0 })
    const { doc, selection } = store.getState()
    expect(first).not.toBe('a')
    expect(selection).toHaveLength(2)
    expect(doc.nodes.c2.children).toEqual(selection)
    expect(selection.map((id) => doc.nodes[id].type)).toEqual([
      'demo.text',
      'demo.button',
    ])
    store.undo()
    expect(store.getState().doc.nodes.c2.children).toEqual([])
  })

  it('duplicates top-level nodes right after each original', () => {
    const { store } = setup()
    store.dispatch({ kind: 'move', id: 't2', to: { parentId: 'c2', index: 0 } })
    store.dispatch({
      kind: 'insert',
      fragment: {
        rootId: 'b2',
        nodes: { b2: node('b2', 'demo.button', { label: 'x' }) },
      },
      at: { parentId: 'c2', index: 1 },
    })
    // c2: [t2, b2]; duplicating both (and a nested/missing/root id) keeps order.
    store.duplicate(['t2', 'b2', 'root', 'nope'])
    const { doc, selection } = store.getState()
    const children = doc.nodes.c2.children ?? []
    expect(children).toHaveLength(4)
    expect([children[0], children[2]]).toEqual(['t2', 'b2'])
    expect(selection).toEqual([children[1], children[3]])
    expect(doc.nodes[children[1]].props).toEqual(doc.nodes.t2.props)
    store.undo()
    expect(store.getState().doc.nodes.c2.children).toEqual(['t2', 'b2'])
  })

  it('skips descendants of duplicated or removed ancestors', () => {
    const { store } = setup()
    store.duplicate(['cols', 'b1'])
    expect(store.getState().doc.nodes.s1.children).toHaveLength(3)
    store.remove(['s2', 't2'])
    expect(store.getState().doc.nodes.s2).toBeUndefined()
    store.undo()
    expect(store.getState().doc.nodes.t2).toBeDefined()
  })

  it('reports a refused duplicate and ignores empty selections', () => {
    const { store, listener } = setup()
    store.duplicate(['root'])
    store.remove(['root', 'nope'])
    expect(listener).not.toHaveBeenCalled()
    store.duplicate(['footer'])
    expect(store.getState().lastError).toEqual({
      code: 'UNIQUE',
      type: 'demo.footer',
    })
    expect(store.getState().selection).toEqual([])
  })

  it('copies one or several top-level nodes as detached fragments', () => {
    const { store } = setup()
    expect(store.copy(['root'])).toBeNull()
    const one = store.copy(['t1'])
    expect(one?.roots).toBeUndefined()
    expect(one?.nodes[one.rootId].props).toEqual({
      text: 'Olá',
      style: { color: '#000' },
    })
    const many = store.copy(['t1', 'b1'])
    expect(many?.roots).toHaveLength(2)
    expect(Object.keys(many?.nodes ?? {})).toHaveLength(2)
  })

  it('pastes inside an accepting anchor, otherwise after it', () => {
    const { store } = setup()
    const clip = store.copy(['b1'])
    if (!clip) throw new Error('copy failed')
    store.paste(clip, 'c2')
    expect(store.getState().doc.nodes.c2.children).toHaveLength(1)
    store.paste(clip, 'b1')
    const c1 = store.getState().doc.nodes.c1.children ?? []
    expect(c1).toHaveLength(2)
    expect(c1[0]).toBe('b1')
    expect(store.getState().selection).toEqual([c1[1]])
  })

  it('pastes after the selection, or at the end of the root', () => {
    const { store } = setup()
    const section = store.copy(['s2'])
    if (!section) throw new Error('copy failed')
    store.select('s1')
    store.paste(section)
    expect(store.getState().doc.nodes.root.children?.[1]).toBe(
      store.getState().selection[0],
    )
    store.select(null)
    store.paste(section)
    const rootChildren = store.getState().doc.nodes.root.children ?? []
    expect(rootChildren.at(-1)).toBe(store.getState().selection[0])
    // Not accepted at the root (and the root has no parent): reported.
    const textClip = store.copy(['t1'])
    if (!textClip) throw new Error('copy failed')
    store.select(null)
    store.paste(textClip, 'nope')
    expect(store.getState().lastError?.code).toBe('NOT_ACCEPTED')
  })

  it('pastes into a container without a children array', () => {
    const doc = sampleDoc()
    doc.nodes.c2 = node('c2', 'demo.column', {})
    const store = createCanvasStore(catalog, doc)
    const clip = store.copy(['b1'])
    if (!clip) throw new Error('copy failed')
    store.paste(clip, 'c2')
    expect(store.getState().doc.nodes.c2.children).toEqual(
      store.getState().selection,
    )
  })

  it('pastes a multi-root fragment in order', () => {
    const { store } = setup()
    const clip = store.copy(['t1', 'b1'])
    if (!clip) throw new Error('copy failed')
    store.paste(clip, 't2')
    const children = store.getState().doc.nodes.s2.children ?? []
    expect(children).toHaveLength(3)
    expect(children.map((id) => store.getState().doc.nodes[id].type)).toEqual([
      'demo.text',
      'demo.text',
      'demo.button',
    ])
  })
})

describe('reset', () => {
  it('replaces the document and clears history and selection', () => {
    const { store } = setup()
    store.select('t1')
    store.dispatch({ kind: 'remove', id: 't2' })
    store.dispatch({ kind: 'remove', id: 'root' })
    const fresh = sampleDoc()
    store.reset(fresh)
    expect(store.getState()).toMatchObject({
      doc: fresh,
      selection: [],
      canUndo: false,
      canRedo: false,
      dirty: false,
      lastError: null,
    })
    store.dispatch({ kind: 'remove', id: 't2' })
    store.markSaved(fresh)
    expect(store.getState().dirty).toBe(true)
    store.undo()
    expect(store.getState().dirty).toBe(false)
  })
})
