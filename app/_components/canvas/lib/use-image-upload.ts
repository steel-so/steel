'use client'

import { useCallback } from 'react'
import { acceptImageFiles } from '@/app/_components/media/use-file-drop-target'
import { notify } from '@/lib/notify'
import { useCanvasEditor } from '../editor-context'

/**
 * Uploads an image file picked, dropped or pasted in the editor and
 * resolves its public URL; `null` when the file was refused (the user was
 * told why) or the upload failed. `undefined` when the editor has no way to
 * upload (URLs only).
 */
export function useImageUpload():
  | ((file: File, accept?: readonly string[]) => Promise<string | null>)
  | undefined {
  const {
    props: { onUploadImage, mediaProvider },
  } = useCanvasEditor()
  const upload = useCallback(
    async (file: File, accept?: readonly string[]) => {
      const [valid] = acceptImageFiles([file], accept)
      if (!valid) return null
      if (onUploadImage) return onUploadImage(valid)
      if (!mediaProvider) return null
      try {
        const item = await mediaProvider.upload(valid)
        return item.url
      } catch (error) {
        notify.error(error, 'Não foi possível enviar a imagem')
        return null
      }
    },
    [onUploadImage, mediaProvider],
  )
  return onUploadImage || mediaProvider ? upload : undefined
}
