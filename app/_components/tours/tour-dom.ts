import type { Box } from '@/src/lib/tours/position'

/** Breakpoint below which `desktopOnly` tours show only their summary. */
export const TOUR_MOBILE_QUERY = '(max-width: 767px)'

/** localStorage switch that turns the automatic opening off (support, QA). */
export const TOURS_OFF_STORAGE_KEY = 'steel.tours.off'

/** Query parameter that opens a tour on arrival: `?tour=<key>`. */
export const TOUR_QUERY_PARAM = 'tour'

/** The visible element marked with `data-tour="<name>"`, if any. */
export function findTourTarget(name: string): HTMLElement | null {
  // Names are kebab-case (enforced by the registry test): no escaping needed.
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)
  for (const node of nodes) {
    const rect = node.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return node
  }
  return null
}

export function boxOf(element: HTMLElement): Box {
  const rect = element.getBoundingClientRect()
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  }
}

export function sameBox(a: Box | null, b: Box | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height
  )
}

export function isMobileViewport(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia(TOUR_MOBILE_QUERY).matches
  )
}

/**
 * Automatic opening is off for browsers driven by automation (smoke scripts,
 * screenshots) and for anyone who set the localStorage switch.
 */
export function isAutoStartDisabled(): boolean {
  if (navigator.webdriver === true) return true
  try {
    return window.localStorage.getItem(TOURS_OFF_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** A dialog on screen means the user is busy: the tour waits for next time. */
export function hasOpenDialog(): boolean {
  return (
    document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
  )
}

/** Reads `?tour=<key>` and removes it from the address bar. */
export function takeTourParam(): string | null {
  const url = new URL(window.location.href)
  const key = url.searchParams.get(TOUR_QUERY_PARAM)
  if (key === null) return null
  url.searchParams.delete(TOUR_QUERY_PARAM)
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
  return key
}
