'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  type PublishChecker,
  type PublishCheckSummary,
  summarizePublishChecks,
} from '@/src/lib/canvas/checklist'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { useCanvasStore } from '../use-canvas'

/**
 * Runs a catalog's `PublishChecker` on the document being edited. Debounced,
 * so typing does not re-run the checks on every keystroke. `checker` must be
 * a stable reference (a module-level function).
 */
export function usePublishChecks(
  checker: PublishChecker,
  delayMs = 250,
): PublishCheckSummary {
  const doc = useCanvasStore((state) => state.doc)
  const [settled, setSettled] = useState<CanvasDocument>(doc)
  useEffect(() => {
    const handle = setTimeout(() => setSettled(doc), delayMs)
    return () => clearTimeout(handle)
  }, [doc, delayMs])
  return useMemo(
    () => summarizePublishChecks(checker(settled)),
    [checker, settled],
  )
}
