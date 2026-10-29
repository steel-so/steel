'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** Height before the content is measured (and when it cannot be). */
const INITIAL_HEIGHT = 900

/**
 * Web version of an issue inside a sandboxed iframe (see
 * `src/lib/newsletter/web-html.ts` for the why). No script runs in the
 * frame; the page sizes it to the content so there is a single scrollbar.
 */
export function NewsletterIssueFrame({
  srcDoc,
  title,
}: {
  srcDoc: string
  title: string
}) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(INITIAL_HEIGHT)

  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument
    if (!doc?.documentElement) return
    const next = Math.max(
      doc.documentElement.scrollHeight,
      doc.body?.scrollHeight ?? 0,
    )
    if (next > 0) setHeight(next)
  }, [])

  useEffect(() => {
    const frame = ref.current
    if (!frame) return
    let observer: ResizeObserver | undefined
    const onLoad = () => {
      measure()
      const body = frame.contentDocument?.body
      if (body && typeof ResizeObserver !== 'undefined') {
        observer?.disconnect()
        observer = new ResizeObserver(measure)
        observer.observe(body)
      }
    }
    frame.addEventListener('load', onLoad)
    // The frame may have loaded before hydration.
    if (frame.contentDocument?.readyState === 'complete') onLoad()
    return () => {
      frame.removeEventListener('load', onLoad)
      observer?.disconnect()
    }
  }, [measure])

  return (
    <iframe
      ref={ref}
      title={title}
      srcDoc={srcDoc}
      sandbox='allow-same-origin allow-popups allow-popups-to-escape-sandbox'
      referrerPolicy='strict-origin-when-cross-origin'
      loading='eager'
      style={{ height }}
      className='block w-full rounded-xl border bg-white'
    />
  )
}
