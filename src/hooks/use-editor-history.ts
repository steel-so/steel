'use client'

import { useCallback, useReducer } from 'react'

/**
 * Generic undo/redo for editors that keep their whole document in one value.
 * Consecutive `set` calls with the same `group` within `COALESCE_MS` become a
 * single step, so undo reverts a typed sentence, not one keystroke.
 */

export const COALESCE_MS = 800
const DEFAULT_LIMIT = 100

type History<T> = {
  past: T[]
  present: T
  future: T[]
  lastGroup: string | null
  lastAt: number
  limit: number
}

type Action<T> =
  | { type: 'set'; value: T; group?: string; at: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; value: T }

function init<T>(arg: { value: T; limit: number }): History<T> {
  return {
    past: [],
    present: arg.value,
    future: [],
    lastGroup: null,
    lastAt: 0,
    limit: arg.limit,
  }
}

function reducer<T>(state: History<T>, action: Action<T>): History<T> {
  switch (action.type) {
    case 'set': {
      if (Object.is(action.value, state.present)) return state
      const coalesce =
        action.group !== undefined &&
        action.group === state.lastGroup &&
        action.at - state.lastAt < COALESCE_MS
      return {
        ...state,
        past: coalesce
          ? state.past
          : [...state.past, state.present].slice(-state.limit),
        present: action.value,
        future: [],
        lastGroup: action.group ?? null,
        lastAt: action.at,
      }
    }
    case 'undo': {
      const previous = state.past.at(-1)
      if (previous === undefined) return state
      return {
        ...state,
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
        lastGroup: null,
        lastAt: 0,
      }
    }
    case 'redo': {
      const [next, ...rest] = state.future
      if (next === undefined) return state
      return {
        ...state,
        past: [...state.past, state.present],
        present: next,
        future: rest,
        lastGroup: null,
        lastAt: 0,
      }
    }
    case 'reset':
      return init({ value: action.value, limit: state.limit })
  }
}

export function useEditorHistory<T>(initial: T, options?: { limit?: number }) {
  const limit = options?.limit ?? DEFAULT_LIMIT
  const [state, dispatch] = useReducer(
    reducer<T>,
    { value: initial, limit },
    init<T>,
  )
  const set = useCallback(
    (value: T, group?: string) =>
      dispatch({ type: 'set', value, group, at: Date.now() }),
    [],
  )
  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const redo = useCallback(() => dispatch({ type: 'redo' }), [])
  const reset = useCallback(
    (value: T) => dispatch({ type: 'reset', value }),
    [],
  )
  return {
    state: state.present,
    set,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  }
}
