'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** Quiet time after the last edit before the draft saves itself. */
export const CHATBOT_AUTOSAVE_DELAY_MS = 2_000

export type ChatbotAutosaveState = 'idle' | 'saving' | 'failed'

/**
 * Debounced autosave of the chatbot draft. A quiet `delayMs` after the last
 * change (`serialized` is the draft's fingerprint) it calls `persist`, which
 * must save the draft and mark it saved. It stays out of the way: nothing
 * runs without permission, for a draft the schema rejects (the manual save
 * explains why), or while another save is in flight; and a draft that failed
 * once is not retried until it changes again.
 */
export function useChatbotAutosave(input: {
  enabled: boolean
  dirty: boolean
  invalid: boolean
  busy: boolean
  serialized: string
  persist: () => Promise<void>
  delayMs?: number
}) {
  const { enabled, dirty, invalid, busy, serialized, persist } = input
  const delayMs = input.delayMs ?? CHATBOT_AUTOSAVE_DELAY_MS
  const [state, setState] = useState<ChatbotAutosaveState>('idle')
  const [autoSaved, setAutoSaved] = useState(false)
  const failedFor = useRef<string | null>(null)
  const persistRef = useRef(persist)
  persistRef.current = persist

  useEffect(() => {
    if (!enabled || !dirty || invalid || busy) return
    if (failedFor.current === serialized) return
    const timer = setTimeout(async () => {
      setState('saving')
      try {
        await persistRef.current()
        failedFor.current = null
        setState('idle')
        setAutoSaved(true)
      } catch {
        failedFor.current = serialized
        setState('failed')
      }
    }, delayMs)
    return () => clearTimeout(timer)
  }, [enabled, dirty, invalid, busy, serialized, delayMs])

  useEffect(() => {
    // A new edit after an automatic save: the "saved" message is stale.
    if (dirty) setAutoSaved(false)
  }, [dirty])

  /** After a manual save: forget a past failure and the "saved" message. */
  const reset = useCallback(() => {
    failedFor.current = null
    setState('idle')
    setAutoSaved(false)
  }, [])

  return { state, autoSaved, reset }
}
