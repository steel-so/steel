'use client'

import {
  Add01Icon,
  Copy01Icon,
  Delete02Icon,
  Folder01Icon,
  MoreHorizontalIcon,
  PaintBoardIcon,
  Search01Icon,
  Tag01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type ReactNode, useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmAction } from '@/components/ui/confirm-action'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useCrmBanners,
  useDeleteCrmBanner,
  useDuplicateCrmBanner,
  useUpdateCrmBannerMeta,
} from '@/src/hooks/use-crm-banners'
import { filterBanners, NO_FOLDER } from '@/src/lib/banners/library'
import { BANNER_OBJECTIVE_LABELS } from '@/src/schemas/crm-banner.schema'
import type { CrmBannerListItemDTO } from '@/types/crm-banner'
import { Field } from './banner-fields'
import { BannerThumb } from './banner-thumb'
import { NewBannerDialog } from './new-banner-dialog'
import { useBannerImageCache, useBannerImages } from './use-banner-images'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function OrganizeDialog({
  banner,
  folders,
  onClose,
  onSave,
  pending,
}: {
  banner: CrmBannerListItemDTO | null
  folders: string[]
  onClose: () => void
  onSave: (folder: string, tags: string[]) => void
  pending: boolean
}) {
  const [folder, setFolder] = useState(banner?.folder ?? '')
  const [tags, setTags] = useState(banner?.tags.join(', ') ?? '')

  return (
    <Dialog open={banner !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Pasta e etiquetas</DialogTitle>
          <DialogDescription>
            Agrupe os banners por campanha, cliente ou canal.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-3'>
          <Field label='Pasta'>
            {(id) => (
              <>
                <Input
                  id={id}
                  value={folder}
                  maxLength={60}
                  list='banner-folders'
                  placeholder='Sem pasta'
                  onChange={(event) => setFolder(event.target.value)}
                />
                <datalist id='banner-folders'>
                  {folders.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label='Etiquetas (separadas por vírgula)'>
            {(id) => (
              <Input
                id={id}
                value={tags}
                placeholder='verão, remarketing'
                onChange={(event) => setTags(event.target.value)}
              />
            )}
          </Field>
        </div>
        <DialogFooter>
          <Button variant='ghost' onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              onSave(
                folder.trim(),
                [
                  ...new Set(
                    tags
                      .split(',')
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  ),
                ].slice(0, 10),
              )
            }
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function BannersList({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const router = useRouter()
  const { data, isLoading, isError, error, refetch } =
    useCrmBanners(workspaceId)
  const duplicate = useDuplicateCrmBanner(workspaceId)
  const remove = useDeleteCrmBanner(workspaceId)
  const update = useUpdateCrmBannerMeta(workspaceId)

  const [search, setSearch] = useState('')
  const [folder, setFolder] = useState<string | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<CrmBannerListItemDTO | null>(null)
  const [organizing, setOrganizing] = useState<CrmBannerListItemDTO | null>(
    null,
  )

  const banners = data ?? []
  const folders = useMemo(
    () => [...new Set(banners.map((b) => b.folder).filter(Boolean))].sort(),
    [banners],
  )
  const tags = useMemo(
    () => [...new Set(banners.flatMap((b) => b.tags))].sort(),
    [banners],
  )
  const visible = useMemo(
    () => filterBanners(banners, { search, folder, tag }),
    [banners, search, folder, tag],
  )

  const cache = useBannerImageCache(workspaceId)
  const coverFormats = useMemo(
    () => banners.flatMap((b) => b.document.formats.slice(0, 1)),
    [banners],
  )
  const { images, fontsReady } = useBannerImages(cache, coverFormats)

  async function duplicateBanner(banner: CrmBannerListItemDTO) {
    try {
      const copy = await duplicate.mutateAsync(banner.id)
      notify.success('Banner duplicado.')
      router.push(`/${slug}/crm/banners/${copy.id}`)
    } catch (err) {
      notify.error(err, 'Não foi possível duplicar o banner')
    }
  }

  return (
    <div className='mx-auto grid w-full max-w-7xl gap-5 p-4 sm:p-6'>
      <div className='flex flex-wrap items-center gap-3'>
        <div className='relative min-w-[14rem] flex-1 sm:max-w-sm'>
          <SteelIcon
            icon={Search01Icon}
            className='pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground'
          />
          <Input
            aria-label='Buscar banners'
            placeholder='Buscar por nome, pasta ou etiqueta…'
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className='pl-8'
          />
        </div>
        <Button className='ml-auto' onClick={() => setCreating(true)}>
          <SteelIcon icon={Add01Icon} />
          Novo banner
        </Button>
      </div>

      {folders.length > 0 || tags.length > 0 ? (
        <fieldset className='flex flex-wrap items-center gap-1.5'>
          <legend className='sr-only'>Filtros</legend>
          {folders.length > 0 ? (
            <>
              <FilterChip
                active={folder === null}
                onClick={() => setFolder(null)}
              >
                Todas as pastas
              </FilterChip>
              <FilterChip
                active={folder === NO_FOLDER}
                onClick={() => setFolder(NO_FOLDER)}
              >
                Sem pasta
              </FilterChip>
              {folders.map((item) => (
                <FilterChip
                  key={item}
                  active={folder === item}
                  onClick={() => setFolder(folder === item ? null : item)}
                >
                  <SteelIcon icon={Folder01Icon} className='size-3.5' />
                  {item}
                </FilterChip>
              ))}
            </>
          ) : null}
          {tags.map((item) => (
            <FilterChip
              key={item}
              active={tag === item}
              onClick={() => setTag(tag === item ? null : item)}
            >
              <SteelIcon icon={Tag01Icon} className='size-3.5' />
              {item}
            </FilterChip>
          ))}
        </fieldset>
      ) : null}

      {isLoading ? (
        <ul
          className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
          aria-busy='true'
        >
          {Array.from({ length: 8 }, (_, index) => (
            <li key={index} className='grid gap-2'>
              <Skeleton className='aspect-[4/3] w-full' />
              <Skeleton className='h-4 w-2/3' />
            </li>
          ))}
        </ul>
      ) : isError ? (
        <div className='grid justify-items-center gap-3 rounded-xl border border-dashed p-10 text-center'>
          <p className='font-medium'>Não foi possível carregar os banners.</p>
          <p className='text-muted-foreground text-sm'>
            {error instanceof Error ? error.message : 'Tente de novo.'}
          </p>
          <Button variant='outline' onClick={() => void refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : banners.length === 0 ? (
        <div className='grid justify-items-center gap-3 rounded-xl border border-dashed p-12 text-center'>
          <SteelIcon
            icon={PaintBoardIcon}
            className='size-10 text-muted-foreground'
          />
          <p className='font-medium'>Crie seu primeiro banner</p>
          <p className='max-w-md text-muted-foreground text-sm'>
            Monte criativos para Google Display, Instagram, Stories, TikTok e
            YouTube a partir de um modelo com a sua marca, e exporte todos os
            tamanhos de uma vez.
          </p>
          <Button onClick={() => setCreating(true)}>
            <SteelIcon icon={Add01Icon} />
            Novo banner
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <p className='rounded-xl border border-dashed p-10 text-center text-muted-foreground text-sm'>
          Nenhum banner encontrado com esses filtros.
        </p>
      ) : (
        <ul className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
          {visible.map((banner) => {
            const cover = banner.document.formats[0]
            const href = `/${slug}/crm/banners/${banner.id}`
            return (
              <li
                key={banner.id}
                className='group relative grid overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md'
              >
                <Link
                  href={href}
                  aria-label={`Abrir ${banner.name}`}
                  className='flex aspect-[4/3] items-center justify-center bg-muted/60 p-4 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
                >
                  {cover ? (
                    <BannerThumb
                      format={cover}
                      images={images}
                      fontsReady={fontsReady}
                      className='rounded-sm shadow-sm'
                    />
                  ) : null}
                </Link>
                <div className='grid gap-1.5 p-3'>
                  <div className='flex items-start justify-between gap-2'>
                    <Link
                      href={href}
                      className='min-w-0 truncate font-medium text-sm hover:underline'
                    >
                      {banner.name}
                    </Link>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant='ghost'
                            size='icon-xs'
                            aria-label={`Ações de ${banner.name}`}
                          />
                        }
                      >
                        <SteelIcon icon={MoreHorizontalIcon} />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end' className='w-52'>
                        <DropdownMenuItem render={<Link href={href} />}>
                          Abrir editor
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => void duplicateBanner(banner)}
                        >
                          <SteelIcon icon={Copy01Icon} />
                          Duplicar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setOrganizing(banner)}>
                          <SteelIcon icon={Folder01Icon} />
                          Pasta e etiquetas
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant='destructive'
                          onClick={() => setDeleting(banner)}
                        >
                          <SteelIcon icon={Delete02Icon} />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <p className='text-muted-foreground text-xs'>
                    {banner.formatCount} formato
                    {banner.formatCount === 1 ? '' : 's'} · editado em{' '}
                    {formatDate(banner.updatedAt)}
                  </p>
                  <div className='flex flex-wrap gap-1'>
                    {banner.objective ? (
                      <Badge variant='secondary'>
                        {BANNER_OBJECTIVE_LABELS[banner.objective]}
                      </Badge>
                    ) : null}
                    {banner.folder ? (
                      <Badge variant='outline'>{banner.folder}</Badge>
                    ) : null}
                    {banner.tags.map((item) => (
                      <Badge key={item} variant='outline'>
                        #{item}
                      </Badge>
                    ))}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <NewBannerDialog
        open={creating}
        onOpenChange={setCreating}
        workspaceId={workspaceId}
        slug={slug}
        folder={folder && folder !== NO_FOLDER ? folder : ''}
      />

      <ConfirmAction
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title='Excluir este banner?'
        description={
          deleting
            ? `“${deleting.name}” e seus ${deleting.formatCount} formato(s) serão removidos. Os arquivos já salvos na biblioteca de imagens continuam lá.`
            : ''
        }
        pending={remove.isPending}
        onConfirm={async () => {
          if (!deleting) return
          try {
            await remove.mutateAsync(deleting.id)
            notify.success('Banner excluído.')
          } catch (err) {
            notify.error(err, 'Não foi possível excluir')
          }
        }}
      />

      <OrganizeDialog
        key={organizing?.id ?? 'none'}
        banner={organizing}
        folders={folders}
        pending={update.isPending}
        onClose={() => setOrganizing(null)}
        onSave={async (nextFolder, nextTags) => {
          if (!organizing) return
          try {
            await update.mutateAsync({
              bannerId: organizing.id,
              data: { folder: nextFolder, tags: nextTags },
            })
            notify.success('Banner atualizado.')
            setOrganizing(null)
          } catch (err) {
            notify.error(err, 'Não foi possível salvar')
          }
        }}
      />
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type='button'
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
        active
          ? 'border-primary bg-primary/10 text-foreground'
          : 'text-muted-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  )
}
