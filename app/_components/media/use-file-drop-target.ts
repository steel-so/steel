'use client'

import { type DragEvent, useCallback, useState } from 'react'
import { notify } from '@/lib/notify'
import { filesOf, hasFiles, imageFileProblem } from './image-file'

/**
 * Splits files into the uploadable ones, telling the user why each of the
 * others was refused (type or 5 MB, decided in `imageFileProblem`).
 */
export function acceptImageFiles(
  files: File[],
  accept?: readonly string[],
): File[] {
  const valid: File[] = []
  for (const file of files) {
    const problem = imageFileProblem(file, accept)
    if (problem) notify.error(problem)
    else valid.push(file)
  }
  return valid
}

/**
 * Drop zone for image files: spread `bind` on the element and read `over`
 * for the highlight. Only drags that carry files react, so dragging a block
 * or text across the zone does nothing.
 */
export function useFileDropTarget({
  onFiles,
  disabled = false,
  multiple = true,
  accept,
}: {
  onFiles: (files: File[]) => void | Promise<void>
  disabled?: boolean
  multiple?: boolean
  accept?: readonly string[]
}) {
  const [over, setOver] = useState(false)

  const onDragOver = useCallback(
    (event: DragEvent) => {
      if (disabled || !hasFiles(event.dataTransfer)) return
      event.preventDefault()
      setOver(true)
    },
    [disabled],
  )
  const onDragLeave = useCallback(() => setOver(false), [])
  const onDrop = useCallback(
    (event: DragEvent) => {
      if (disabled || !hasFiles(event.dataTransfer)) return
      event.preventDefault()
      setOver(false)
      const valid = acceptImageFiles(filesOf(event.dataTransfer), accept)
      const files = multiple ? valid : valid.slice(0, 1)
      if (files.length > 0) void onFiles(files)
    },
    [disabled, multiple, accept, onFiles],
  )

  return { over, bind: { onDragOver, onDragLeave, onDrop } }
}
