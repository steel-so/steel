'use client'

import { useSyncExternalStore } from 'react'

/** Name and subject of the template: edited in the top bar, saved apart
 * from the canvas document. A tiny store so typing re-renders only the
 * fields that read it, never the canvas. */
export interface TemplateMeta {
  name: string
  subject: string
}

export interface TemplateMetaStore {
  get(): TemplateMeta
  set(patch: Partial<TemplateMeta>): void
  subscribe(listener: () => void): () => void
}

export function createTemplateMetaStore(
  initial: TemplateMeta,
): TemplateMetaStore {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(patch) {
      const next = { ...state, ...patch }
      if (next.name === state.name && next.subject === state.subject) return
      state = next
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function useTemplateMeta<T>(
  store: TemplateMetaStore,
  selector: (meta: TemplateMeta) => T,
): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  )
}
