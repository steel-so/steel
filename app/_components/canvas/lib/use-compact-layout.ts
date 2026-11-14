'use client'

import { useSyncExternalStore } from 'react'

const QUERY = '(max-width: 1023px)'

function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

/** True below 1024 px, where the sidebar and the inspector collapse into
 * drawers over the canvas. Server and tests without `matchMedia`: false. */
export function useCompactLayout(): boolean {
  return useSyncExternalStore(
    subscribe,
    () =>
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia(QUERY).matches
        : false,
    () => false,
  )
}
