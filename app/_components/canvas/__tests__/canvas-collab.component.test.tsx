import { act, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { getNode } from '@/src/lib/canvas/ops'
import type { CanvasStore } from '@/src/lib/canvas/store'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  CANVAS_FLUSHED,
  parseCanvasStateless,
} from '@/src/lib/canvas-collab/names'
import { seedYDoc } from '@/src/lib/canvas-collab/ydoc'
import { demoCatalog, demoDocument } from '../__demo__/demo-catalog'
import { CanvasEditor } from '../canvas-editor'
import type {
  CollabAwareness,
  CollabConnect,
  CollabTransportEvents,
} from '../collab/session'

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('../inspector/controls/richtext', () => ({
  RichTextControl: () => null,
}))

const RELAY = Symbol('relay')

/**
 * In-memory realtime room: a server Y document, update relay between the
 * clients, a shared awareness and the flush handshake. `sync()` plays the
 * provider's first sync for every connected client.
 */
function createRoom(initial: CanvasDocument = demoDocument()) {
  const server = new Y.Doc()
  seedYDoc(server, initial)
  const states = new Map<number, unknown>()
  const listeners = new Set<() => void>()
  const clients: Array<{
    ydoc: Y.Doc
    events: CollabTransportEvents
    online: boolean
  }> = []
  let nextClientId = 1
  const flushes: string[] = []
  const emit = () => {
    for (const listener of [...listeners]) listener()
  }

  server.on('update', (update: Uint8Array, origin: unknown) => {
    for (const client of clients) {
      if (client.online && origin !== client.ydoc) {
        Y.applyUpdate(client.ydoc, update, RELAY)
      }
    }
  })

  const connect: CollabConnect = ({ ydoc, events }) => {
    const client = { ydoc, events, online: true }
    clients.push(client)
    ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== RELAY && client.online) {
        Y.applyUpdate(server, update, ydoc)
      }
    })
    const clientID = nextClientId++
    const awareness: CollabAwareness = {
      clientID,
      getStates: () => states,
      setLocalStateField(field, value) {
        states.set(clientID, {
          ...((states.get(clientID) as object) ?? {}),
          [field]: value,
        })
        emit()
      },
      on: (_event, listener) => listeners.add(listener),
      off: (_event, listener) => listeners.delete(listener),
    }
    return {
      awareness,
      sendStateless(payload) {
        const message = parseCanvasStateless(payload)
        if (!message) return
        flushes.push(message.requestId)
        queueMicrotask(() =>
          events.stateless(
            JSON.stringify({
              type: CANVAS_FLUSHED,
              requestId: message.requestId,
              ok: true,
            }),
          ),
        )
      },
      destroy() {
        states.delete(clientID)
        client.online = false
      },
    }
  }

  return {
    server,
    connect,
    flushes,
    clients,
    sync() {
      act(() => {
        for (const client of clients) {
          Y.applyUpdate(client.ydoc, Y.encodeStateAsUpdate(server), RELAY)
          client.events.synced()
        }
      })
    },
    drop(index: number) {
      act(() => {
        clients[index].online = false
        clients[index].events.disconnected()
      })
    },
  }
}

interface Editor {
  store: CanvasStore
  onSave: ReturnType<typeof vi.fn>
  view: ReturnType<typeof within>
}

function openEditor(
  connect: CollabConnect,
  user: { id: string; name: string },
): Editor {
  const onSave = vi.fn(async (_doc: CanvasDocument) => true)
  const editor = { onSave } as Partial<Editor>
  const { container } = render(
    <CanvasEditor
      catalog={demoCatalog}
      initialDocument={demoDocument()}
      viewportWidths={{ base: 1200, tablet: 768, mobile: 375 }}
      title={user.name}
      actions={(ctx) => {
        editor.store = ctx.store
        return null
      }}
      onSave={onSave}
      collaboration={{ documentName: 'canvas.site-page.p1', user, connect }}
    />,
  )
  editor.view = within(container)
  return editor as Editor
}

/** jsdom has no layout: ProseMirror measures ranges in the canvas frame. */
async function layoutless(editor: Editor) {
  const frame = editor.view.getByTestId('canvas-frame') as HTMLIFrameElement
  await waitFor(() =>
    expect(
      frame.contentDocument?.querySelector('[data-canvas-id="hero-title"]'),
    ).toBeTruthy(),
  )
  const view = frame.contentDocument?.defaultView as unknown as {
    Range: typeof Range
  }
  view.Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
  view.Range.prototype.getBoundingClientRect ??= () => new DOMRect()
}

Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= () => new DOMRect()

const ANA = { id: 'u-ana', name: 'Ana Souza' }
const BIA = { id: 'u-bia', name: 'Bia Lima' }

afterEach(() => {
  vi.useRealTimers()
})

describe('canvas co-editing UI', () => {
  it('shows who else is editing, their selection and the text they hold', async () => {
    const room = createRoom()
    const ana = openEditor(room.connect, ANA)
    const bia = openEditor(room.connect, BIA)
    room.sync()
    await layoutless(ana)
    await layoutless(bia)

    const people = await ana.view.findByRole('list', {
      name: 'Pessoas nesta página',
    })
    expect(within(people).getByLabelText('Bia Lima')).toBeTruthy()
    expect(within(people).getByLabelText('Ana Souza (você)')).toBeTruthy()

    act(() => bia.store.select('hero-title'))
    const box = await ana.view.findByTestId('canvas-remote-selection')
    expect(box.dataset.nodeId).toBe('hero-title')
    expect(box.textContent).toBe('Bia')
    expect(box.style.outlineColor).not.toBe('')

    act(() => bia.store.setEditingText('hero-title'))
    await waitFor(() =>
      expect(ana.view.getByTestId('canvas-remote-selection').textContent).toBe(
        'Bia está editando este texto',
      ),
    )
    // Ana cannot open the same text while Bia edits it.
    act(() => ana.store.setEditingText('hero-title'))
    expect(ana.store.getState().editingText).toBeNull()
    act(() => ana.store.select('hero-text'))
    act(() => ana.store.setEditingText('hero-text'))
    expect(ana.store.getState().editingText).toBe('hero-text')
  })

  it('applies each other’s edits live and saves through the server', async () => {
    const room = createRoom()
    const ana = openEditor(room.connect, ANA)
    const bia = openEditor(room.connect, BIA)
    room.sync()

    act(() => {
      ana.store.dispatch({
        kind: 'update',
        id: 'hero-title',
        set: { text: 'Título da Ana' },
      })
    })
    expect(getNode(bia.store.getState().doc, 'hero-title')?.props.text).toBe(
      'Título da Ana',
    )
    // Bia's undo history is hers alone.
    expect(bia.store.getState().canUndo).toBe(false)
    expect(ana.view.getByTestId('canvas-save-status').dataset.status).toBe(
      'saved',
    )

    // Ctrl+S asks the server to save; REST is not used while live.
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 's', ctrlKey: true }),
      )
    })
    await waitFor(() => expect(room.flushes.length).toBeGreaterThan(0))
    await waitFor(() => expect(ana.store.getState().dirty).toBe(false))
    expect(ana.onSave).not.toHaveBeenCalled()
    expect(bia.onSave).not.toHaveBeenCalled()
  })

  it('falls back to REST autosave when the realtime server is unreachable', async () => {
    vi.useFakeTimers()
    const room = createRoom()
    const ana = openEditor(room.connect, ANA)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(ana.view.getByTestId('canvas-collab-offline').textContent).toBe(
      'Sem colaboração em tempo real',
    )
    act(() => {
      ana.store.dispatch({
        kind: 'update',
        id: 'hero-title',
        set: { text: 'Offline' },
      })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })
    expect(ana.onSave).toHaveBeenCalledTimes(1)
    expect(room.flushes).toHaveLength(0)
  })

  it('saves pending changes through REST when the connection drops', async () => {
    const room = createRoom()
    const ana = openEditor(room.connect, ANA)
    room.sync()
    act(() => {
      ana.store.dispatch({
        kind: 'update',
        id: 'hero-title',
        set: { text: 'Antes da queda' },
      })
    })
    expect(ana.onSave).not.toHaveBeenCalled()
    room.drop(0)
    await waitFor(() => expect(ana.onSave).toHaveBeenCalledTimes(1))
    expect(ana.view.getByTestId('canvas-collab-offline')).toBeTruthy()
  })

  it('marks a view-only session', () => {
    const room = createRoom()
    const ana = openEditor((args) => {
      const transport = room.connect(args)
      queueMicrotask(() => args.events.authenticated(true))
      return transport
    }, ANA)
    return waitFor(() => {
      room.sync()
      expect(ana.view.getByTestId('canvas-collab-readonly').textContent).toBe(
        'Somente leitura',
      )
    })
  })

  it('works without collaboration (no presence, no badge)', () => {
    const onSave = vi.fn(async () => true)
    render(
      <CanvasEditor
        catalog={demoCatalog}
        initialDocument={demoDocument()}
        viewportWidths={{ base: 1200 }}
        title='Sem colaboração'
        onSave={onSave}
      />,
    )
    expect(screen.queryByTestId('canvas-collab-offline')).toBeNull()
    expect(screen.queryByTestId('canvas-collab')).toBeNull()
  })
})
