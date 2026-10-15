'use client'

import { useCallback } from 'react'
import { useCanvasEditor } from '@/app/_components/canvas/editor-context'
import { notify } from '@/lib/notify'
import { type SiteEditorTarget, useSiteEditor } from './site-editor-context'

const RETRY_MS = 300

/**
 * Opens another page/global in the canvas after saving the current
 * document (switching remounts the canvas, so unsaved edits would be lost).
 * Must be used inside `CanvasEditor`.
 */
export function useOpenTarget() {
  const { save } = useCanvasEditor()
  const { open } = useSiteEditor()
  return useCallback(
    async (target: SiteEditorTarget): Promise<boolean> => {
      let saved = await save()
      if (!saved) {
        // A save may be in flight; it reports `false` until it ends.
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
        saved = await save()
      }
      if (!saved) {
        notify.error('Salve as alterações antes de trocar de página.')
        return false
      }
      await open(target)
      return true
    },
    [save, open],
  )
}
