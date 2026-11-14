'use client'

import { useMemo } from 'react'
import type { CanvasImageBlock } from '@/app/_components/canvas/types'
import { crmEmailMediaProvider } from '@/src/hooks/use-crm-email-builder'
import type { CanvasImage } from '@/src/lib/canvas/values'

/** The e-mail/document image library of a workspace (one bucket). */
export function useEmailMediaProvider(workspaceId: string) {
  return useMemo(() => crmEmailMediaProvider(workspaceId), [workspaceId])
}

/** The e-mail image block: a dropped or pasted picture replaces `src` and
 * keeps the alt text, link and size of the block it lands on. */
export const EMAIL_IMAGE_BLOCK: CanvasImageBlock = {
  type: 'email.image',
  toProps: (src, current) => {
    const image = (current?.image ?? { alt: '' }) as CanvasImage
    return { image: { ...image, src } }
  },
}
