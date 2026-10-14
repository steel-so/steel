'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Per-viewer layout choices for a wiki page (full width, fixed toolbar, side
 * panel). They are conveniences, so `localStorage` is enough: when storage is
 * blocked (private window, previews) the page simply opens on the defaults.
 */
export type WikiPanelTab = 'outline' | 'info' | 'resources'

export interface WikiPreferences {
  fullWidth: boolean
  fixedToolbar: boolean
  panelOpen: boolean
  panelTab: WikiPanelTab
}

export const WIKI_PREFERENCES_KEY = 'steel.wiki.preferences'

export const DEFAULT_WIKI_PREFERENCES: WikiPreferences = {
  fullWidth: false,
  fixedToolbar: true,
  panelOpen: false,
  panelTab: 'outline',
}

function read(): WikiPreferences {
  try {
    const raw = window.localStorage.getItem(WIKI_PREFERENCES_KEY)
    if (!raw) return DEFAULT_WIKI_PREFERENCES
    const parsed = JSON.parse(raw) as Partial<WikiPreferences>
    return {
      fullWidth:
        typeof parsed.fullWidth === 'boolean'
          ? parsed.fullWidth
          : DEFAULT_WIKI_PREFERENCES.fullWidth,
      fixedToolbar:
        typeof parsed.fixedToolbar === 'boolean'
          ? parsed.fixedToolbar
          : DEFAULT_WIKI_PREFERENCES.fixedToolbar,
      panelOpen:
        typeof parsed.panelOpen === 'boolean'
          ? parsed.panelOpen
          : DEFAULT_WIKI_PREFERENCES.panelOpen,
      panelTab:
        parsed.panelTab === 'info' ||
        parsed.panelTab === 'resources' ||
        parsed.panelTab === 'outline'
          ? parsed.panelTab
          : DEFAULT_WIKI_PREFERENCES.panelTab,
    }
  } catch {
    return DEFAULT_WIKI_PREFERENCES
  }
}

function write(preferences: WikiPreferences) {
  try {
    window.localStorage.setItem(
      WIKI_PREFERENCES_KEY,
      JSON.stringify(preferences),
    )
  } catch {
    // Storage blocked: the choice lasts for this visit only.
  }
}

export function useWikiPreferences() {
  // Defaults on the server render and the first client paint, then the
  // stored choice — reading storage during render would mismatch hydration.
  const [preferences, setPreferences] = useState(DEFAULT_WIKI_PREFERENCES)

  useEffect(() => {
    setPreferences(read())
  }, [])

  const update = useCallback((patch: Partial<WikiPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch }
      write(next)
      return next
    })
  }, [])

  return [preferences, update] as const
}
