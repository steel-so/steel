'use client'

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { CanvasStore } from '@/src/lib/canvas/store'
import { connectHocuspocus } from './hocuspocus'
import {
  type CollabConnect,
  type CollabSession,
  type CollabSnapshot,
  createCollabSession,
} from './session'

/** Real-time co-editing of the open document (`CanvasEditorProps`). */
export interface CanvasCollaboration {
  /** Realtime room: `canvasDocumentName(kind, id)`. */
  documentName: string
  user: { id: string; name: string; image?: string | null }
  /** Transport override (tests); Hocuspocus over `/realtime` by default. */
  connect?: CollabConnect
}

const CollabContext = createContext<CollabSession | null>(null)

export const CollabProvider = CollabContext.Provider

/** The session of the editor, or `null` without co-editing. */
export function useCollabSession(): CollabSession | null {
  return useContext(CollabContext)
}

const NO_COLLAB: CollabSnapshot = {
  status: 'offline',
  readOnly: false,
  peers: [],
  locks: new Map(),
  syncing: false,
}

const noop = () => () => {}

/** A slice of the co-editing state (re-renders when it changes). */
export function useCollabSnapshot<T>(
  selector: (snapshot: CollabSnapshot) => T,
): T {
  const session = useCollabSession()
  const get = () => selector(session ? session.getSnapshot() : NO_COLLAB)
  return useSyncExternalStore(session ? session.subscribe : noop, get, get)
}

/**
 * Opens the co-editing session of a store while the editor is mounted (in
 * the browser only; the server render has none). The room is read once:
 * hosts remount the editor to switch documents.
 */
export function useCanvasCollaboration(
  store: CanvasStore,
  config: CanvasCollaboration | undefined,
): CollabSession | null {
  const [session, setSession] = useState<CollabSession | null>(null)
  const initial = useRef(config)
  useEffect(() => {
    const options = initial.current
    if (!options) return
    const created = createCollabSession({
      store,
      documentName: options.documentName,
      user: options.user,
      connect: options.connect ?? connectHocuspocus,
    })
    setSession(created)
    return () => {
      created.destroy()
      setSession(null)
    }
  }, [store])
  return session
}
