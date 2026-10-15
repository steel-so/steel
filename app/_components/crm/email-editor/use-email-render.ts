'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { renderEmailDocument } from '@/src/lib/canvas-email/render'
import type { RenderedEmail } from '@/src/lib/crm-email-builder/render'
import { toProductData, useEmailEditorData } from './editor-data'

/**
 * The document rendered exactly as it is sent (`renderEmailDocument`, the
 * same components as the canvas, without editor markup), variables intact.
 * Re-renders after `delay` ms of quiet; `null` until the first render or
 * while `doc` is `null`.
 */
export function useRenderedEmail(
  doc: CanvasDocument | null,
  subject: string,
  delay = 150,
): RenderedEmail | null {
  const { brand, products } = useEmailEditorData()
  const productData = useMemo(() => toProductData(products), [products])
  const [rendered, setRendered] = useState<RenderedEmail | null>(null)

  useEffect(() => {
    if (!doc) return
    let cancelled = false
    const handle = setTimeout(() => {
      renderEmailDocument(doc, { brand, subject, products: productData })
        .then((email) => {
          if (!cancelled) setRendered(email)
        })
        .catch(() => {
          // A document the shell accepted always renders; a failure here
          // only leaves the previous render on screen.
        })
    }, delay)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [doc, subject, brand, productData, delay])

  return rendered
}
