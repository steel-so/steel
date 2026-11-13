'use client'

import {
  ImageAltField,
  ImagePicker,
} from '@/app/_components/canvas/inspector/controls/media'
import { useCanvasEditor } from '@/app/_components/canvas/editor-context'
import type { CustomControlProps } from '@/src/lib/canvas/registry'

/**
 * Image controls of the `document` catalog. Document images keep flat props
 * (`src`, `alt`, `decorative`) from before the shared media library, so they
 * cannot use the generic `image` control (`{ src, alt }`); these wrap the
 * same picker and alt field.
 */

/** `src` of a document image: preview, upload, library, drop and URL. */
export function DocumentImageSrcControl({
  value,
  onChange,
}: CustomControlProps) {
  return (
    <ImagePicker
      label='Imagem'
      src={typeof value === 'string' ? value : ''}
      onChange={(src) => onChange(src)}
    />
  )
}

/** Alt text of a document image: required unless marked as decorative.
 * `alt` and `decorative` change in one step (one undo). */
export function DocumentImageAltControl({ node }: CustomControlProps) {
  const { store } = useCanvasEditor()
  const props = node.props as {
    src?: string
    alt?: string
    decorative?: boolean
  }
  const alt = props.alt ?? ''
  const decorative = !!props.decorative
  return (
    <ImageAltField
      label='Imagem'
      alt={alt}
      decorative={decorative}
      missing={!!props.src?.trim() && !alt.trim() && !decorative}
      onChange={(nextAlt, nextDecorative) =>
        store.dispatch({
          kind: 'update',
          id: node.id,
          set: { alt: nextAlt, decorative: nextDecorative || undefined },
        })
      }
    />
  )
}
