'use client'

import { useCallback, useRef, useState } from 'react'

const MAX_STEPS = 100
const COALESCE_MS = 700

interface HistoryState<T> {
  past: T[]
  present: T
  future: T[]
}

export interface SetOptions {
  /** Do not create an undo step (drag in progress, programmatic sync). */
  silent?: boolean
  /** Edits with the same key within a short window share one undo step. */
  coalesceKey?: string
}

/** Undo/redo over a value, with coalescing for typing and sliders. */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState<HistoryState<T>>({
    past: [],
    present: initial,
    future: [],
  })
  const last = useRef<{ key: string; at: number } | null>(null)

  const set = useCallback(
    (updater: T | ((previous: T) => T), options: SetOptions = {}) => {
      let record = !options.silent
      if (record && options.coalesceKey) {
        const now = Date.now()
        const previous = last.current
        if (
          previous &&
          previous.key === options.coalesceKey &&
          now - previous.at < COALESCE_MS
        ) {
          record = false
        }
        last.current = { key: options.coalesceKey, at: now }
      } else if (record) {
        last.current = null
      }
      setState((current) => {
        const next =
          typeof updater === 'function'
            ? (updater as (previous: T) => T)(current.present)
            : updater
        if (Object.is(next, current.present)) return current
        if (!record) return { ...current, present: next }
        return {
          past: [...current.past, current.present].slice(-MAX_STEPS),
          present: next,
          future: [],
        }
      })
    },
    [],
  )

  /** Starts an undo step now; the changes that follow are `silent`. */
  const checkpoint = useCallback(() => {
    last.current = null
    setState((current) => ({
      past: [...current.past, current.present].slice(-MAX_STEPS),
      present: current.present,
      future: [],
    }))
  }, [])

  const undo = useCallback(() => {
    last.current = null
    setState((current) => {
      const previous = current.past[current.past.length - 1]
      if (previous === undefined) return current
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future],
      }
    })
  }, [])

  const redo = useCallback(() => {
    last.current = null
    setState((current) => {
      const next = current.future[0]
      if (next === undefined) return current
      return {
        past: [...current.past, current.present],
        present: next,
        future: current.future.slice(1),
      }
    })
  }, [])

  return {
    value: state.present,
    set,
    checkpoint,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  }
}
