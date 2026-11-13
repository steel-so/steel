'use client'

import { useCallback, useEffect, useState } from 'react'
import { filesOf, hasFiles } from '@/app/_components/media/image-file'
import { acceptImageFiles } from '@/app/_components/media/use-file-drop-target'
import { notify } from '@/lib/notify'
import { fragmentForType, getNode, parentOf } from '@/src/lib/canvas/ops'
import type { CanvasNodeId } from '@/src/lib/canvas/types'
import {
  type CanvasEditorContextValue,
  useCanvasEditor,
} from '../editor-context'
import type { CanvasImageBlock } from '../types'
import { isTypingTarget } from '../use-shortcuts'
import { findInsertLocation } from './drop-target'
import { nodeIdAt } from './frame-handle'
import { useImageUpload } from './use-image-upload'

/**
 * Puts the picture `url` in the document: onto `targetId` when it is an
 * image block (the block keeps its alt text, size and link), otherwise as a
 * new image block next to the selection.
 */
export function placeImageUrl(
  ctx: Pick<CanvasEditorContextValue, 'store' | 'catalog'> & {
    block: CanvasImageBlock
  },
  url: string,
  targetId: CanvasNodeId | null,
): void {
  const { store, catalog, block } = ctx
  const { doc, selection } = store.getState()
  const target = targetId ? getNode(doc, targetId) : undefined
  if (target && target.type === block.type) {
    store.dispatch({
      kind: 'update',
      id: target.id,
      set: block.toProps(url, target.props),
    })
    return
  }
  const base = fragmentForType(catalog, block.type)
  const at = findInsertLocation(doc, catalog, block.type, selection[0] ?? null)
  if (!base || !at) {
    notify.info('Selecione uma seção ou um container para inserir a imagem.')
    return
  }
  const root = base.nodes[base.rootId]
  store.insertFragment(
    {
      ...base,
      nodes: {
        ...base.nodes,
        [base.rootId]: {
          ...root,
          props: { ...root.props, ...block.toProps(url) },
        },
      },
    },
    at,
  )
}

/**
 * Drop an image file onto the canvas, or paste one (Ctrl+V), to put it in
 * the document: over an image block it replaces the picture, anywhere else
 * it adds a new image block next to the selection. Needs the catalog's
 * `imageBlock` and a way to upload; otherwise it does nothing.
 *
 * Returns `over`: a file is being dragged across the canvas.
 */
export function useCanvasImageInput(): { over: boolean } {
  const { props, catalog, store, frame } = useCanvasEditor()
  const upload = useImageUpload()
  const block = props.imageBlock
  const [over, setOver] = useState(false)

  /** The image block at or above `id`. */
  const imageNodeFrom = useCallback(
    (id: CanvasNodeId | null): CanvasNodeId | null => {
      const { doc } = store.getState()
      let current = id
      while (current !== null) {
        if (getNode(doc, current)?.type === block?.type) return current
        current = parentOf(doc, current)
      }
      return null
    },
    [store, block?.type],
  )

  const place = useCallback(
    async (file: File, targetId: CanvasNodeId | null) => {
      if (!block || !upload) return
      const url = await upload(file)
      if (url) placeImageUrl({ store, catalog, block }, url, targetId)
    },
    [block, upload, store, catalog],
  )

  useEffect(() => {
    if (!block || !upload) return
    const placeAll = (files: File[], firstTarget: CanvasNodeId | null) => {
      files.forEach((file, index) => {
        void place(file, index === 0 ? firstTarget : null)
      })
    }

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return
      event.preventDefault()
      setOver(true)
    }
    const onDragLeave = (event: DragEvent) => {
      if (!event.relatedTarget) setOver(false)
    }
    const onFrameDrop = (event: DragEvent) => {
      setOver(false)
      if (!hasFiles(event.dataTransfer)) return
      event.preventDefault()
      const files = acceptImageFiles(filesOf(event.dataTransfer))
      placeAll(files, imageNodeFrom(nodeIdAt(event.target)))
    }
    const onPaste = (event: ClipboardEvent) => {
      if (isTypingTarget(event.target)) return
      const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
        file.type.startsWith('image/'),
      )
      if (files.length === 0) return
      event.preventDefault()
      const valid = acceptImageFiles(files)
      placeAll(valid, imageNodeFrom(store.getState().selection[0] ?? null))
    }

    let frameDoc: Document | null = null
    const detachFrame = () => {
      frameDoc?.removeEventListener('dragover', onDragOver)
      frameDoc?.removeEventListener('dragleave', onDragLeave)
      frameDoc?.removeEventListener('drop', onFrameDrop)
      frameDoc?.removeEventListener('paste', onPaste)
    }
    const attachFrame = () => {
      if (frame.document === frameDoc) return
      detachFrame()
      frameDoc = frame.document
      frameDoc?.addEventListener('dragover', onDragOver)
      frameDoc?.addEventListener('dragleave', onDragLeave)
      frameDoc?.addEventListener('drop', onFrameDrop)
      frameDoc?.addEventListener('paste', onPaste)
    }
    window.addEventListener('paste', onPaste)
    attachFrame()
    const unsubscribe = frame.subscribe(attachFrame)
    return () => {
      window.removeEventListener('paste', onPaste)
      detachFrame()
      unsubscribe()
    }
  }, [block, upload, frame, store, place, imageNodeFrom])

  return { over }
}
