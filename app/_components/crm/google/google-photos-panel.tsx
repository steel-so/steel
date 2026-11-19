'use client'

import { Delete02Icon, Upload01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useRef, useState } from 'react'
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
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useCrmGooglePhotos,
  useDeleteGooglePhoto,
  useUploadGooglePhoto,
} from '@/src/hooks/use-crm-google-presence'
import {
  GOOGLE_PHOTO_CATEGORIES,
  GOOGLE_PHOTO_CATEGORY_LABELS,
  GOOGLE_PHOTO_MAX_BYTES,
  GOOGLE_PHOTO_TYPES,
} from '@/src/schemas/crm-google-presence.schema'

/** Gallery of the location: upload (JPG/PNG up to 5 MB) and remove photos. */
export function GooglePhotosPanel({ workspaceId }: { workspaceId: string }) {
  const photos = useCrmGooglePhotos(workspaceId, true)
  const upload = useUploadGooglePhoto(workspaceId)
  const remove = useDeleteGooglePhoto(workspaceId)
  const fileInput = useRef<HTMLInputElement>(null)
  const [category, setCategory] = useState<string>('ADDITIONAL')
  const [toRemove, setToRemove] = useState<string | null>(null)

  function onFile(file: File | undefined) {
    if (!file) return
    if (!(GOOGLE_PHOTO_TYPES as readonly string[]).includes(file.type)) {
      notify.error('Envie uma imagem JPG ou PNG.')
      return
    }
    if (file.size > GOOGLE_PHOTO_MAX_BYTES) {
      notify.error('A foto deve ter no máximo 5 MB.')
      return
    }
    upload.mutate(
      { file, category },
      {
        onSuccess: () => notify.success('Foto enviada ao Google.'),
        onError: (error) => notify.error(error),
      },
    )
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <select
          aria-label='Tipo da foto'
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className='h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30'
        >
          {GOOGLE_PHOTO_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {GOOGLE_PHOTO_CATEGORY_LABELS[value]}
            </option>
          ))}
        </select>
        <input
          ref={fileInput}
          type='file'
          accept='image/jpeg,image/png'
          className='hidden'
          onChange={(event) => {
            onFile(event.target.files?.[0])
            event.target.value = ''
          }}
        />
        <Button
          variant='outline'
          disabled={upload.isPending}
          onClick={() => fileInput.current?.click()}
        >
          <SteelIcon icon={Upload01Icon} size={14} />
          {upload.isPending ? 'Enviando…' : 'Enviar foto'}
        </Button>
        <span className='text-muted-foreground text-xs'>
          JPG ou PNG, de 10 KB a 5 MB. O Google leva alguns minutos para exibir.
        </span>
      </div>

      {photos.isLoading ? (
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
          <Skeleton className='aspect-square' />
          <Skeleton className='aspect-square' />
          <Skeleton className='aspect-square' />
          <Skeleton className='aspect-square' />
        </div>
      ) : photos.error ? (
        <p role='alert' className='text-destructive text-sm'>
          {photos.error.message}
        </p>
      ) : (photos.data ?? []).length === 0 ? (
        <p className='rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm'>
          Nenhuma foto ainda. Perfis com fotos recebem mais cliques e pedidos de
          rota.
        </p>
      ) : (
        <ul className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
          {(photos.data ?? []).map((photo) => (
            <li
              key={photo.name}
              className='group relative aspect-square overflow-hidden rounded-xl border border-border/60 bg-muted'
            >
              <img
                src={photo.thumbnailUrl}
                alt={
                  photo.category
                    ? (GOOGLE_PHOTO_CATEGORY_LABELS[
                        photo.category as keyof typeof GOOGLE_PHOTO_CATEGORY_LABELS
                      ] ?? 'Foto do perfil')
                    : 'Foto do perfil'
                }
                loading='lazy'
                className='size-full object-cover'
              />
              <Button
                variant='destructive'
                size='icon-sm'
                aria-label='Remover foto'
                className='absolute top-2 right-2 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100'
                onClick={() => setToRemove(photo.name)}
              >
                <SteelIcon icon={Delete02Icon} size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={toRemove !== null}
        onOpenChange={(open) => {
          if (!open) setToRemove(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover esta foto?</AlertDialogTitle>
            <AlertDialogDescription>
              A foto sai do seu perfil no Google. Isso não pode ser desfeito.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!toRemove) return
                remove.mutate(toRemove, {
                  onSuccess: () => notify.success('Foto removida.'),
                  onError: (error) => notify.error(error),
                })
                setToRemove(null)
              }}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
