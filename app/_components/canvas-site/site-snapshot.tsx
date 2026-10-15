'use client'

import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { createSiteCatalog } from '@/src/lib/canvas-site/catalog'
import type { SiteRenderContext } from '@/src/lib/canvas-site/context'
import { compileSiteCss } from '@/src/lib/canvas-site/css'
import { SiteDocument } from '@/src/lib/canvas-site/render'
import type { SiteTheme } from '@/src/lib/canvas-site/theme'

/**
 * Live miniature of site documents (preset cards, template gallery, site
 * cards): the published render (`SiteDocument` + `compileSiteCss`) inside a
 * shadow root, laid out at a desktop width and scaled down to the box. A
 * shadow root costs far less than an iframe — dozens of thumbnails stay
 * cheap — and isolates the site's CSS from the app in both directions.
 * Mounted only when the box nears the viewport; never interactive.
 */

/** `true` once the element is within `margin` of the viewport (and from
 * then on). Without IntersectionObserver it is visible right away. */
export function useNearViewport(
  ref: RefObject<Element | null>,
  margin = '200px',
): boolean {
  const [near, setNear] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (near || !element) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      { rootMargin: margin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, margin, near])
  return near
}

export interface SiteSnapshotProps {
  /** Rendered top to bottom (header, page, footer). */
  docs: CanvasDocument[]
  theme: SiteTheme
  context?: SiteRenderContext
  /** Layout width before scaling (a desktop viewport). */
  width?: number
  /** Box size and look (aspect ratio, corners); the content is clipped. */
  className?: string
}

export function SiteSnapshot({
  docs,
  theme,
  context,
  width = 1280,
  className,
}: SiteSnapshotProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const near = useNearViewport(boxRef)
  const [root, setRoot] = useState<ShadowRoot | null>(null)
  const [scale, setScale] = useState(0)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!near || !host) return
    setRoot(host.shadowRoot ?? host.attachShadow({ mode: 'open' }))
  }, [near])

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const measure = () => setScale(box.clientWidth / width)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [width])

  const css = useMemo(
    () => (root ? compileSiteCss(docs, { theme }) : ''),
    [root, docs, theme],
  )
  const catalog = useMemo(() => createSiteCatalog(context ?? {}), [context])

  return (
    <div
      ref={boxRef}
      aria-hidden='true'
      data-testid='site-snapshot'
      className={cn('relative overflow-hidden bg-muted/40', className)}
    >
      <div
        ref={hostRef}
        inert
        className='pointer-events-none absolute top-0 left-0 origin-top-left select-none'
        style={{ width, transform: `scale(${scale})` }}
      />
      {root &&
        createPortal(
          <>
            <style>{`:host{display:block}${css}`}</style>
            {docs.map((doc, index) => (
              <SiteDocument
                key={index}
                doc={doc}
                catalog={catalog}
              />
            ))}
          </>,
          root,
        )}
    </div>
  )
}
