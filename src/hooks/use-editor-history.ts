'use client'

import { useCallback, useMemo, useRef, useState } from 'react'

type History<T> = { past: T[]; present: T; future: T[] }

type Options = { limit?: number }

const DEFAULT_LIMIT = 100
// Edits with the same key inside this window collapse into one undo step
// (typing in a text field should not create one step per keystroke).
const COALESCE_MS = 800

/**
 * Undo/redo state for editors.
 * `set(next, coalesceKey?)` accepts a value or an updater; calls that share a
 * `coalesceKey` within a short window replace the current step instead of
 * stacking a new one.
 */
export function useEditorHistory<T>(initial: T, options: Options = {}) {
  const limit = options.limit ?? DEFAULT_LIMIT
  const [history, setHistory] = useState<History<T>>({
    past: [],
    present: initial,
    future: [],
  })
  const lastEdit = useRef<{ key: string; at: number } | null>(null)

  const set = useCallback(
    (next: T | ((current: T) => T), coalesceKey?: string) => {
      const now = Date.now()
      const coalesce =
        coalesceKey !== undefined &&
        lastEdit.current?.key === coalesceKey &&
        now - lastEdit.current.at < COALESCE_MS
      lastEdit.current = coalesceKey ? { key: coalesceKey, at: now } : null
      setHistory((cur) => {
        const value =
          typeof next === 'function'
            ? (next as (current: T) => T)(cur.present)
            : next
        if (Object.is(value, cur.present)) return cur
        if (coalesce) return { ...cur, present: value, future: [] }
        return {
          past: [...cur.past, cur.present].slice(-limit),
          present: value,
          future: [],
        }
      })
    },
    [limit],
  )

  const undo = useCallback(() => {
    lastEdit.current = null
    setHistory((cur) => {
      if (cur.past.length === 0) return cur
      const previous = cur.past[cur.past.length - 1]
      return {
        past: cur.past.slice(0, -1),
        present: previous,
        future: [cur.present, ...cur.future],
      }
    })
  }, [])

  const redo = useCallback(() => {
    lastEdit.current = null
    setHistory((cur) => {
      if (cur.future.length === 0) return cur
      const [next, ...rest] = cur.future
      return {
        past: [...cur.past, cur.present].slice(-limit),
        present: next,
        future: rest,
      }
    })
  }, [limit])

  const reset = useCallback((value: T) => {
    lastEdit.current = null
    setHistory({ past: [], present: value, future: [] })
  }, [])

  return useMemo(
    () => ({
      state: history.present,
      set,
      undo,
      redo,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      reset,
    }),
    [history, set, undo, redo, reset],
  )
}
