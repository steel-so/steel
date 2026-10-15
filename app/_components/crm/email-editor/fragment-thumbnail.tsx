'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { CanvasFragment } from '@/src/lib/canvas/types'
import { fragmentPreviewDocument } from '@/src/lib/canvas-email/fragments'
import { renderEmailDocument } from '@/src/lib/canvas-email/render'
import { toProductData, useEmailEditorData } from './editor-data'

/** Width the thumbnail renders at before scaling (the e-mail + margin). */
const RENDER_WIDTH = 648

/**
 * Live preview of a saved block or generated section: the fragment
 * rendered alone with the workspace brand (same components as the send),
 * scaled down into the card. Static — no pointer events.
 */
export function FragmentThumbnail({
  fragment,
  className,
}: {
  fragment: CanvasFragment
  className?: string
}) {
  const { brand, products } = useEmailEditorData()
  const productData = useMemo(() => toProductData(products), [products])
  const [html, setHtml] = useState<string | null>(null)
  const [scale, setScale] = useState(0.36)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const doc = fragmentPreviewDocument(fragment)
    if (!doc) return
    let cancelled = false
    renderEmailDocument(doc, { brand, subject: '', products: productData })
      .then((email) => {
        if (!cancelled) setHtml(email.html)
      })
      .catch(() => {
        // A fragment the server validated renders; on failure the card
        // keeps its placeholder.
      })
    return () => {
      cancelled = true
    }
  }, [fragment, brand, productData])

  useEffect(() => {
    const element = box.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) {
        setScale(entry.contentRect.width / RENDER_WIDTH)
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={box}
      aria-hidden
      className={cn(
        'pointer-events-none relative w-full overflow-hidden bg-muted/60',
        className,
      )}
    >
      {html ? (
        <iframe
          title='Prévia do bloco'
          srcDoc={html}
          tabIndex={-1}
          sandbox=''
          className='absolute top-0 left-0 origin-top-left border-0'
          style={{
            width: RENDER_WIDTH,
            height: 900,
            transform: `scale(${scale})`,
          }}
        />
      ) : null}
    </div>
  )
}
