'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { renderEmailDocument } from '@/src/lib/canvas-email/render'
import type { EmailProductData } from '@/src/lib/canvas-email/theme'
import type { EmailBrand } from '@/src/lib/crm-email-builder/brand'
import type { RenderedEmail } from '@/src/lib/crm-email-builder/render'
import { toProductData, useEmailEditorData } from './editor-data'

/**
 * `doc` rendered exactly as it is sent (`renderEmailDocument`, the same
 * components as the canvas, without editor markup), variables intact, with
 * the given brand and products. Re-renders after `delay` ms of quiet; `null`
 * until the first render or while `doc` is `null`.
 */
export function useRenderedEmailOnce(
  doc: CanvasDocument | null,
  subject: string,
  brand: EmailBrand,
  products: Record<string, EmailProductData>,
  delay = 0,
  /** Newsletter issue: render the subscription footer. */
  newsletterName?: string,
): RenderedEmail | null {
  const [rendered, setRendered] = useState<RenderedEmail | null>(null)

  useEffect(() => {
    if (!doc) return
    let cancelled = false
    const handle = setTimeout(() => {
      renderEmailDocument(doc, {
        brand,
        subject,
        products,
        ...(newsletterName !== undefined
          ? { subscription: { newsletterName } }
          : {}),
      })
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
  }, [doc, subject, brand, products, delay, newsletterName])

  return rendered
}

/** The live document with the editor's brand and products. */
export function useRenderedEmail(
  doc: CanvasDocument | null,
  subject: string,
  delay = 150,
): RenderedEmail | null {
  const { brand, products, newsletterName } = useEmailEditorData()
  const productData = useMemo(() => toProductData(products), [products])
  return useRenderedEmailOnce(
    doc,
    subject,
    brand,
    productData,
    delay,
    newsletterName,
  )
}
