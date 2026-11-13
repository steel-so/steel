import type { CanvasDocument } from '@/src/lib/canvas/types'

/**
 * Local copy of the document kept only while saving fails, so a closed tab
 * or a long outage does not lose work. It is removed on the first save that
 * succeeds and offered back ("Recuperar") the next time the editor opens.
 * Storage can be blocked or full: every access is guarded.
 */
export interface CanvasDraft {
  doc: CanvasDocument
  savedAt: number
}

const PREFIX = 'steel:canvas-draft:'

/** One draft per editor address (page, template, document). */
export function draftStorageKey(override?: string): string | null {
  if (override) return `${PREFIX}${override}`
  if (typeof window === 'undefined') return null
  return `${PREFIX}${window.location.pathname}${window.location.search}`
}

export function writeDraft(key: string | null, doc: CanvasDocument): void {
  if (!key) return
  try {
    const draft: CanvasDraft = { doc, savedAt: Date.now() }
    window.localStorage.setItem(key, JSON.stringify(draft))
  } catch {
    // Storage is full or blocked: nothing else to do.
  }
}

export function clearDraft(key: string | null): void {
  if (!key) return
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Storage is blocked.
  }
}

/** The stored draft, or `null` when there is none or it is unreadable. */
export function readDraft(key: string | null): CanvasDraft | null {
  if (!key) return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CanvasDraft> | null
    if (
      !parsed ||
      typeof parsed.savedAt !== 'number' ||
      !parsed.doc ||
      typeof parsed.doc.rootId !== 'string' ||
      typeof parsed.doc.nodes !== 'object'
    ) {
      return null
    }
    return { doc: parsed.doc, savedAt: parsed.savedAt }
  } catch {
    return null
  }
}
