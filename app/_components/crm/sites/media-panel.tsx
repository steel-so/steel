'use client'

import {
  Copy01Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  Upload04Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import { type DragEvent, useMemo, useRef, useState } from 'react'
import { useCanvasDraggable } from '@/app/_components/canvas/dnd/canvas-dnd'
import { useCanvasEditor } from '@/app/_components/canvas/editor-context'
import { findInsertLocation } from '@/app/_components/canvas/lib/drop-target'
import { SteelIcon } from '@/components/icon/icon'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { crmSitesKeys, useSiteMedia } from '@/src/hooks/use-crm-sites'
import { getNode } from '@/src/lib/canvas/nodes'
import { fragmentForType } from '@/src/lib/canvas/ops'
import type { CanvasFragment } from '@/src/lib/canvas/types'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import type { SiteMediaItemDTO } from '@/types/site-studio'
import { formatBytes } from './format'
import { useSiteEditor } from './site-editor-context'

const ACCEPT = 'image/jpeg,image/png,image/webp'
const MAX_BYTES = 5 * 1024 * 1024

/** A `site.image` fragment showing `url`. */
export function imageFragment(
  base: CanvasFragment,
  url: string,
): CanvasFragment {
  const root = base.nodes[base.rootId]
  return {
    ...base,
    nodes: {
      ...base.nodes,
      [base.rootId]: {
        ...root,
        props: { ...root.props, image: { src: url, alt: '' } },
      },
    },
  }
}

function MediaTile({
  item,
  onRemove,
}: {
  item: SiteMediaItemDTO
  onRemove: (item: SiteMediaItemDTO) => void
}) {
  const { catalog, store } = useCanvasEditor()
  const { canEdit } = useSiteEditor()
  // The site catalog always registers `site.image`.
  const fragment = useMemo(
    () =>
      imageFragment(
        fragmentForType(catalog, SITE_TYPES.image) as CanvasFragment,
        item.url,
      ),
    [catalog, item.url],
  )
  const { setNodeRef, attributes, listeners, isDragging } = useCanvasDraggable(
    `media:${item.source}:${item.id}`,
    { kind: 'fragment', fragment, label: 'Imagem' },
  )

  /** Click: the selected image gets this file; otherwise insert one. */
  function use() {
    const { doc, selection } = store.getState()
    const selected = selection[0] ? getNode(doc, selection[0]) : undefined
    if (selected?.type === SITE_TYPES.image) {
      const current = selected.props.image as { alt?: string } | undefined
      store.dispatch({
        kind: 'update',
        id: selected.id,
        set: { image: { src: item.url, alt: current?.alt ?? '' } },
      })
      return
    }
    const at = findInsertLocation(
      doc,
      catalog,
      SITE_TYPES.image,
      selection[0] ?? null,
    )
    if (!at) {
      notify.info('Selecione uma seção ou um container para inserir a imagem.')
      return
    }
    store.insertFragment(fragment, at)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(item.url)
      notify.success('Endereço da imagem copiado.')
    } catch {
      notify.error('Não foi possível copiar.')
    }
  }

  return (
    <li className='group relative'>
      <button
        type='button'
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        onClick={use}
        disabled={!canEdit}
        aria-label={`Usar imagem ${item.id} — arraste para o canvas ou pressione Enter`}
        className={cn(
          'block aspect-square w-full cursor-grab touch-none overflow-hidden rounded-md border bg-muted transition-[box-shadow] hover:ring-2 hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing',
          isDragging && 'opacity-50',
        )}
      >
        <img
          src={item.url}
          alt=''
          loading='lazy'
          draggable={false}
          className='size-full object-cover'
        />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label='Ações da imagem'
          className='absolute top-1 right-1 flex size-6 items-center justify-center rounded-md bg-background/90 text-foreground opacity-0 shadow-xs backdrop-blur transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[popup-open]:opacity-100'
        >
          <SteelIcon icon={MoreHorizontalIcon} className='size-3.5' />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-48'>
          <DropdownMenuItem onClick={() => void copy()}>
            <SteelIcon icon={Copy01Icon} />
            Copiar endereço
          </DropdownMenuItem>
          {item.source === 'site' && canEdit ? (
            <DropdownMenuItem
              variant='destructive'
              onClick={() => onRemove(item)}
            >
              <SteelIcon icon={Delete02Icon} />
              Excluir
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className='pointer-events-none absolute bottom-1 left-1 rounded bg-background/90 px-1 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100'>
        {formatBytes(item.size)}
      </span>
    </li>
  )
}

/**
 * "Mídia": the workspace's site image library. Upload (button or drop),
 * then click an image to put it in the selected image (or insert a new
 * one), or drag it onto the canvas.
 */
export function MediaPanel() {
  const { api, workspaceId, canEdit } = useSiteEditor()
  const media = useSiteMedia(workspaceId)
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [over, setOver] = useState(false)
  const [removing, setRemoving] = useState<SiteMediaItemDTO | null>(null)

  async function upload(files: FileList | File[]) {
    const list = [...files].filter((file) => {
      if (!ACCEPT.split(',').includes(file.type)) {
        notify.error(`${file.name}: use JPEG, PNG ou WebP.`)
        return false
      }
      if (file.size > MAX_BYTES) {
        notify.error(`${file.name}: o limite é 5 MB.`)
        return false
      }
      return true
    })
    if (list.length === 0) return
    setUploading((count) => count + list.length)
    await Promise.all(
      list.map(async (file) => {
        try {
          const item = await api.uploadMedia(file)
          queryClient.setQueryData(
            crmSitesKeys.media(workspaceId),
            (current: SiteMediaItemDTO[] | undefined) => [
              item,
              ...(current ?? []),
            ],
          )
        } catch (error) {
          notify.error(error, `Não foi possível enviar ${file.name}`)
        } finally {
          setUploading((count) => count - 1)
        }
      }),
    )
  }

  async function confirmRemove() {
    if (!removing) return
    const item = removing
    setRemoving(null)
    try {
      await api.removeMedia(item.id)
      queryClient.setQueryData(
        crmSitesKeys.media(workspaceId),
        (current: SiteMediaItemDTO[] | undefined) =>
          current?.filter((media) => media.id !== item.id),
      )
      notify.success('Imagem excluída.')
    } catch (error) {
      notify.error(error, 'Não foi possível excluir a imagem')
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    if (canEdit && event.dataTransfer.files.length > 0) {
      void upload(event.dataTransfer.files)
    }
  }

  const items = media.data ?? []
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col transition-colors',
        over && 'bg-primary/5',
      )}
      data-testid='media-panel'
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className='grid gap-2 p-3 pb-2'>
        <Button
          size='sm'
          variant='outline'
          disabled={!canEdit}
          onClick={() => input.current?.click()}
        >
          <SteelIcon icon={Upload04Icon} data-icon='inline-start' />
          {uploading > 0 ? `Enviando ${uploading}…` : 'Enviar imagens'}
        </Button>
        <input
          ref={input}
          type='file'
          accept={ACCEPT}
          multiple
          hidden
          aria-label='Escolher imagens'
          onChange={(event) => {
            if (event.target.files) void upload(event.target.files)
            event.target.value = ''
          }}
        />
        <p className='text-[11px] text-muted-foreground'>
          JPEG, PNG ou WebP até 5 MB. Solte arquivos aqui para enviar.
        </p>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto px-3 pb-4'>
        {media.isLoading ? (
          <div className='grid grid-cols-2 gap-2'>
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} className='aspect-square' />
            ))}
          </div>
        ) : media.error ? (
          <p className='py-6 text-center text-destructive text-sm'>
            Não foi possível carregar as imagens.
          </p>
        ) : items.length === 0 ? (
          <p className='py-8 text-center text-muted-foreground text-sm'>
            Nenhuma imagem ainda. Envie a primeira para usar nas páginas.
          </p>
        ) : (
          <ul aria-label='Imagens' className='grid grid-cols-2 gap-2'>
            {items.map((item) => (
              <MediaTile
                key={`${item.source}-${item.id}`}
                item={item}
                onRemove={setRemoving}
              />
            ))}
          </ul>
        )}
      </div>
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta imagem?</AlertDialogTitle>
            <AlertDialogDescription>
              Páginas que ainda usam a imagem passam a mostrá-la quebrada,
              inclusive no site no ar. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => void confirmRemove()}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
