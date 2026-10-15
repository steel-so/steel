'use client'

import { HocuspocusProvider } from '@hocuspocus/provider'
import { NEXT_PUBLIC_REALTIME_URL } from '@/lib/env/env'
import type { CollabAwareness, CollabConnect } from './session'

/**
 * Same endpoint as the Wiki: `NEXT_PUBLIC_REALTIME_URL` when set (dev runs
 * the server on its own port), otherwise `/realtime` on this origin, which
 * nginx proxies to the realtime container — so the session cookie goes
 * along and no proxy rule changes for the canvas rooms.
 */
export function canvasRealtimeUrl(): string {
  if (NEXT_PUBLIC_REALTIME_URL) return NEXT_PUBLIC_REALTIME_URL
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/realtime`
}

export const connectHocuspocus: CollabConnect = ({
  documentName,
  ydoc,
  events,
}) => {
  const provider = new HocuspocusProvider({
    url: canvasRealtimeUrl(),
    name: documentName,
    document: ydoc,
    onSynced: ({ state }) => {
      if (state) events.synced()
    },
    onDisconnect: () => events.disconnected(),
    onAuthenticated: ({ scope }) => events.authenticated(scope === 'readonly'),
    onAuthenticationFailed: () => events.authenticationFailed(),
    onStateless: ({ payload }) => events.stateless(payload),
    onUnsyncedChanges: ({ number }) => events.unsyncedChanges(number),
  })
  return {
    awareness: provider.awareness as unknown as CollabAwareness,
    sendStateless: (payload) => provider.sendStateless(payload),
    destroy: () => provider.destroy(),
  }
}
