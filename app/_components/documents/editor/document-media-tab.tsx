'use client'

import { useSyncExternalStore } from 'react'
import { useCanvasEditor } from '@/app/_components/canvas/editor-context'
import { ImageAltField } from '@/app/_components/canvas/inspector/controls/media'
import { placeImageUrl } from '@/app/_components/canvas/lib/use-canvas-image-input'
import type { CanvasSidebarTab } from '@/app/_components/canvas/types'
import { MediaLibrary } from '@/app/_components/media/media-library-picker'
import { getNode } from '@/src/lib/canvas/nodes'
import type { CanvasStore } from '@/src/lib/canvas/store'
import { useDocumentEditor } from './document-editor-context'

/** Text that describes the selected image block. */
function SelectedImageAlt({ store }: { store: CanvasStore }) {
  const id = useSyncExternalStore(
    store.subscribe,
    () => {
      const { doc, selection } = store.getState()
      const node = selection[0] ? getNode(doc, selection[0]) : undefined
      return node?.type === 'image' ? node.id : null
    },
    () => null,
  )
  const props = useSyncExternalStore(
    store.subscribe,
    () => (id ? getNode(store.getState().doc, id)?.props : undefined),
    () => undefined,
  ) as { src?: string; alt?: string; decorative?: boolean } | undefined
  if (!id || !props) return null
  const alt = props.alt ?? ''
  const decorative = !!props.decorative
  return (
    <div className='border-b px-3 pb-3'>
      <p className='mb-2 font-medium text-xs'>Imagem selecionada</p>
      <ImageAltField
        label='Imagem selecionada'
        alt={alt}
        decorative={decorative}
        missing={!!props.src?.trim() && !alt.trim() && !decorative}
        onChange={(nextAlt, nextDecorative) =>
          store.dispatch({
            kind: 'update',
            id,
            set: { alt: nextAlt, decorative: nextDecorative || undefined },
          })
        }
      />
    </div>
  )
}

/**
 * "Mídia" tab of the document editor: the workspace image library (search,
 * upload, drop) and the description of the selected image. Clicking an
 * image puts it in the selected image block, or adds a new one.
 */
function DocumentMediaPanel({ store }: { store: CanvasStore }) {
  const { catalog, props } = useCanvasEditor()
  const { canEdit } = useDocumentEditor()
  const provider = props.mediaProvider
  const block = props.imageBlock
  if (!provider) return null
  return (
    <div className='flex min-h-0 flex-1 flex-col pt-3'>
      <SelectedImageAlt store={store} />
      <MediaLibrary
        provider={provider}
        canEdit={canEdit}
        onSelect={
          block && canEdit
            ? (item) =>
                placeImageUrl(
                  { store, catalog, block },
                  item.url,
                  store.getState().selection[0] ?? null,
                )
            : undefined
        }
      />
    </div>
  )
}

/** The "Mídia" sidebar tab (`extraTabs` of the canvas editor). */
export function documentMediaTab(): CanvasSidebarTab {
  return {
    id: 'media',
    label: 'Mídia',
    icon: 'image',
    render: ({ store }) => <DocumentMediaPanel store={store} />,
  }
}
