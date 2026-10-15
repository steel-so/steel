'use client'

import { useMemo } from 'react'
import { compileSiteCss } from '@/src/lib/canvas-site/css'
import type { SiteTheme } from '@/src/lib/canvas-site/theme'
import { useCanvasStore } from '../canvas/use-canvas'

/**
 * Stylesheet of the site being edited, for the canvas iframe (`frameHead`
 * of `CanvasEditor`): the same compiler as the published page, recompiled
 * as the document changes (unchanged nodes hit the per-node cache).
 */
export function SiteFrameStyles({ theme }: { theme: SiteTheme }) {
  const doc = useCanvasStore((state) => state.doc)
  const css = useMemo(
    () => compileSiteCss(doc, { theme, editing: true }),
    [doc, theme],
  )
  return <style data-site-css=''>{css}</style>
}
