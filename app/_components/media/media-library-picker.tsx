'use client'

import {
  Delete02Icon,
  Search01Icon,
  Upload04Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { ConfirmAction } from '@/components/ui/confirm-action'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { formatBytes, IMAGE_ACCEPT } from './image-file'
import type { MediaItem, MediaProvider } from './media-types'
import { acceptImageFiles, useFileDropTarget } from './use-file-drop-target'

/** Friendly name of an item: its own, or the file name without the hash. */
export function mediaItemName(item: MediaItem): string {
  return item.name?.trim() || item.id
}

/** Items whose name matches every word of `query` (case-insensitive). */
export function filterMedia(items: MediaItem[], query: string): MediaItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return items
  return items.filter((item) => {
    const haystack = `${mediaItemName(item)} ${item.alt ?? ''}`.toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

function MediaTile({
  item,
  canRemove,
  removing,
  onSelect,
  onRemove,
}: {
  item: MediaItem
  canRemove: boolean
  removing: boolean
  onSelect?: (item: MediaItem) => void
  onRemove: (item: MediaItem) => void
}) {
  return (
    <li className='group relative'>
      <button
        type='button'
        onClick={() => onSelect?.(item)}
        disabled={!onSelect}
        aria-label={`Usar imagem ${mediaItemName(item)}`}
        className='block aspect-square w-full overflow-hidden rounded-md border bg-muted transition-shadow hover:ring-2 hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default'
      >
        <img
          src={item.url}
          alt=''
          loading='lazy'
          draggable={false}
          className='size-full object-cover'
        />
      </button>
      {item.size !== undefined && (
        <span className='pointer-events-none absolute bottom-1 left-1 rounded bg-background/90 px-1 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'>
          {formatBytes(item.size)}
        </span>
      )}
      {canRemove && (
        <ConfirmAction
          trigger={
            <button
              type='button'
              aria-label={`Excluir imagem ${mediaItemName(item)}`}
              className='absolute top-1 right-1 flex size-6 items-center justify-center rounded-md bg-background/90 text-muted-foreground opacity-0 shadow-xs transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100'
            >
              <SteelIcon icon={Delete02Icon} className='size-3.5' />
            </button>
          }
          title='Excluir esta imagem?'
          description='Páginas, e-mails e documentos que ainda usam a imagem passam a mostrá-la quebrada. Esta ação não pode ser desfeita.'
          pending={removing}
          onConfirm={() => onRemove(item)}
        />
      )}
    </li>
  )
}

/**
 * Image library of one builder: search, upload (button or drop) and a grid.
 * `onSelect` makes tiles pickable; without it the grid only manages files.
 */
export function MediaLibrary({
  provider,
  onSelect,
  canEdit = true,
  className,
}: {
  provider: MediaProvider
  onSelect?: (item: MediaItem) => void
  canEdit?: boolean
  className?: string
}) {
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(0)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const media = useQuery({ queryKey: provider.key, queryFn: provider.list })

  async function upload(files: File[]) {
    setUploading((count) => count + files.length)
    await Promise.all(
      files.map(async (file) => {
        try {
          const item = await provider.upload(file)
          queryClient.setQueryData<MediaItem[]>(provider.key, (current) => [
            item,
            ...(current ?? []).filter((other) => other.id !== item.id),
          ])
        } catch (error) {
          notify.error(error, `Não foi possível enviar ${file.name}`)
        } finally {
          setUploading((count) => count - 1)
        }
      }),
    )
  }

  async function remove(item: MediaItem) {
    if (!provider.remove) return
    setRemovingId(item.id)
    try {
      await provider.remove(item)
      queryClient.setQueryData<MediaItem[]>(provider.key, (current) =>
        current?.filter((other) => other.id !== item.id),
      )
      notify.success('Imagem excluída.')
    } catch (error) {
      notify.error(error, 'Não foi possível excluir a imagem')
    } finally {
      setRemovingId(null)
    }
  }

  const drop = useFileDropTarget({ onFiles: upload, disabled: !canEdit })
  const all = media.data ?? []
  const items = useMemo(() => filterMedia(all, query), [all, query])

  return (
    <div
      {...drop.bind}
      data-testid='media-library'
      className={cn(
        'flex min-h-0 flex-1 flex-col transition-colors',
        drop.over && 'bg-primary/5',
        className,
      )}
    >
      <div className='grid gap-2 p-3 pb-2'>
        <div className='relative'>
          <SteelIcon
            icon={Search01Icon}
            className='pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground'
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder='Buscar imagem'
            aria-label='Buscar imagem'
            className='h-8 pl-8 text-xs'
          />
        </div>
        {canEdit && (
          <>
            <Button
              size='sm'
              variant='outline'
              onClick={() => input.current?.click()}
            >
              <SteelIcon icon={Upload04Icon} data-icon='inline-start' />
              {uploading > 0 ? `Enviando ${uploading}…` : 'Enviar imagens'}
            </Button>
            <input
              ref={input}
              type='file'
              accept={IMAGE_ACCEPT}
              multiple
              hidden
              aria-label='Escolher imagens'
              onChange={(event) => {
                const valid = acceptImageFiles([...(event.target.files ?? [])])
                if (valid.length > 0) void upload(valid)
                event.target.value = ''
              }}
            />
            <p className='text-[11px] text-muted-foreground'>
              JPEG, PNG ou WebP até 5 MB. Solte arquivos aqui para enviar.
            </p>
          </>
        )}
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto px-3 pb-4'>
        {media.isLoading ? (
          <div className='grid grid-cols-3 gap-2'>
            {[0, 1, 2, 3, 4, 5].map((key) => (
              <Skeleton key={key} className='aspect-square' />
            ))}
          </div>
        ) : media.error ? (
          <div className='flex flex-col items-center gap-2 py-6 text-center'>
            <p className='text-destructive text-sm'>
              Não foi possível carregar as imagens.
            </p>
            <Button
              size='sm'
              variant='outline'
              onClick={() => void media.refetch()}
            >
              Tentar de novo
            </Button>
          </div>
        ) : all.length === 0 ? (
          <p className='py-8 text-center text-muted-foreground text-sm'>
            Nenhuma imagem ainda.
            {canEdit ? ' Envie a primeira para usar aqui.' : ''}
          </p>
        ) : items.length === 0 ? (
          <p className='py-8 text-center text-muted-foreground text-sm'>
            Nenhuma imagem com “{query.trim()}”.
          </p>
        ) : (
          <ul aria-label='Imagens' className='grid grid-cols-3 gap-2'>
            {items.map((item) => (
              <MediaTile
                key={item.id}
                item={item}
                canRemove={
                  canEdit && !!provider.remove && item.removable !== false
                }
                removing={removingId === item.id}
                onSelect={onSelect}
                onRemove={(target) => void remove(target)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** "Escolher da biblioteca": the library in a dialog; picking closes it. */
export function MediaLibraryPicker({
  open,
  onOpenChange,
  provider,
  onSelect,
  canEdit = true,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: MediaProvider
  onSelect: (item: MediaItem) => void
  canEdit?: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex h-[min(34rem,85vh)] flex-col gap-0 p-0 sm:max-w-xl'>
        <DialogHeader className='border-b p-4'>
          <DialogTitle>Biblioteca de imagens</DialogTitle>
          <DialogDescription>
            Clique em uma imagem para usá-la, ou envie uma nova.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <MediaLibrary
            provider={provider}
            canEdit={canEdit}
            onSelect={(item) => {
              onSelect(item)
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
