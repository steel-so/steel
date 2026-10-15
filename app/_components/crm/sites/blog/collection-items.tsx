'use client'

import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowUp01Icon,
  Delete02Icon,
  PencilEdit02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { ApiError } from '@/src/hooks/_fetch'
import {
  siteBlogApi,
  siteBlogKeys,
  useSiteCollectionItems,
} from '@/src/hooks/use-site-blog'
import { formatSiteDate } from '@/src/lib/sites/blog/format'
import type {
  SiteCollectionDTO,
  SiteCollectionItemDTO,
} from '@/types/site-blog'
import {
  CollectionItemDialog,
  type ItemFormValue,
} from './collection-item-dialog'

/**
 * Items of one collection: list with search, publish toggle, order
 * (up/down), edit and delete. Published items show on the site right away.
 */
export function CollectionItemsScreen({
  workspaceId,
  slug,
  siteId,
  collectionId,
}: {
  workspaceId: string
  slug: string
  siteId: string
  collectionId: string
}) {
  const api = useMemo(
    () => siteBlogApi(workspaceId, siteId),
    [workspaceId, siteId],
  )
  const queryClient = useQueryClient()
  const canEdit = useCan('landing-pages', 'EDIT')
  const canDelete = useCan('landing-pages', 'DELETE')
  const collection = useQuery<SiteCollectionDTO>({
    queryKey: [...siteBlogKeys.collections(workspaceId, siteId), collectionId],
    queryFn: () => api.collection(collectionId),
  })
  const items = useSiteCollectionItems(workspaceId, siteId, collectionId)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<SiteCollectionItemDTO | 'new' | null>(
    null,
  )

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: siteBlogKeys.all(workspaceId, siteId),
    })

  async function submit(value: ItemFormValue): Promise<boolean> {
    try {
      if (editing === 'new') await api.createItem(collectionId, value)
      else if (editing) await api.updateItem(collectionId, editing.id, value)
      await refresh()
      notify.success('Item salvo.')
      return true
    } catch (error) {
      notify.error(error, 'Não foi possível salvar o item')
      return false
    }
  }

  async function togglePublished(item: SiteCollectionItemDTO) {
    try {
      await api.updateItem(collectionId, item.id, {
        status: item.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED',
      })
      await refresh()
    } catch (error) {
      notify.error(error, 'Não foi possível mudar o item')
    }
  }

  async function move(index: number, delta: -1 | 1) {
    const list = items.data ?? []
    const to = index + delta
    if (to < 0 || to >= list.length) return
    const ids = list.map((item) => item.id)
    ;[ids[index], ids[to]] = [ids[to], ids[index]]
    try {
      const reordered = await api.reorderItems(collectionId, ids)
      queryClient.setQueryData(
        siteBlogKeys.items(workspaceId, siteId, collectionId),
        reordered,
      )
    } catch (error) {
      notify.error(error, 'Não foi possível mudar a ordem')
    }
  }

  async function remove(item: SiteCollectionItemDTO) {
    if (!window.confirm(`Excluir ${item.title}? Isso não pode ser desfeito.`)) {
      return
    }
    try {
      await api.removeItem(collectionId, item.id)
      await refresh()
      notify.success('Item excluído.')
    } catch (error) {
      notify.error(error, 'Não foi possível excluir o item')
    }
  }

  const back = `/${slug}/crm/sites/${siteId}`

  if (collection.error) {
    const missing =
      collection.error instanceof ApiError &&
      (collection.error.status === 404 || collection.error.status === 403)
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-6 text-center'>
        <p className='max-w-sm text-muted-foreground text-sm'>
          {missing
            ? 'Esta coleção não existe mais ou você não tem acesso a ela.'
            : 'Não foi possível abrir a coleção.'}
        </p>
        <Button
          variant='outline'
          size='sm'
          nativeButton={false}
          render={<Link href={back} />}
        >
          Voltar para o site
        </Button>
      </div>
    )
  }

  const term = search.trim().toLowerCase()
  const list = (items.data ?? []).filter(
    (item) => !term || item.title.toLowerCase().includes(term),
  )

  return (
    <div className='mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6'>
      <div className='flex flex-wrap items-center gap-3'>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label='Voltar para o editor do site'
          nativeButton={false}
          render={<Link href={back} />}
        >
          <SteelIcon icon={ArrowLeft01Icon} />
        </Button>
        <div className='min-w-0 flex-1'>
          {collection.data ? (
            <>
              <h1 className='truncate font-semibold text-xl'>
                {collection.data.name}
              </h1>
              <p className='text-muted-foreground text-sm'>
                {collection.data.templateGlobalId
                  ? `Cada item tem a própria página em /${collection.data.slug}/…`
                  : 'Crie a página do item na aba Coleções do editor para cada item ter o próprio endereço.'}
              </p>
            </>
          ) : (
            <Skeleton className='h-7 w-48' />
          )}
        </div>
        <Button
          disabled={!canEdit || !collection.data}
          onClick={() => setEditing('new')}
        >
          <SteelIcon icon={Add01Icon} data-icon='inline-start' />
          {collection.data ? 'Novo item' : 'Novo item'}
        </Button>
      </div>

      <Input
        aria-label='Buscar itens'
        placeholder='Buscar itens'
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className='max-w-sm'
      />

      {items.isLoading ? (
        <div className='grid gap-2'>
          <Skeleton className='h-14' />
          <Skeleton className='h-14' />
          <Skeleton className='h-14' />
        </div>
      ) : list.length === 0 ? (
        <p className='rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm'>
          {term ? 'Nenhum item com essa busca.' : 'Nenhum item ainda.'}
        </p>
      ) : (
        <ul className='grid gap-2' data-testid='collection-items'>
          {list.map((item) => {
            const index = (items.data ?? []).indexOf(item)
            return (
              <li
                key={item.id}
                className='flex flex-wrap items-center gap-3 rounded-lg border p-3'
              >
                <div className='min-w-0 flex-1'>
                  <p className='truncate font-medium'>{item.title}</p>
                  <p className='truncate text-muted-foreground text-xs'>
                    /{item.slug} · atualizado em{' '}
                    {formatSiteDate(item.updatedAt)}
                  </p>
                </div>
                <Button
                  size='xs'
                  variant={
                    item.status === 'PUBLISHED' ? 'secondary' : 'outline'
                  }
                  disabled={!canEdit}
                  onClick={() => void togglePublished(item)}
                >
                  {item.status === 'PUBLISHED' ? 'Publicado' : 'Rascunho'}
                </Button>
                <div className='flex items-center'>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={`Subir ${item.title}`}
                    disabled={!canEdit || !!term || index === 0}
                    onClick={() => void move(index, -1)}
                  >
                    <SteelIcon icon={ArrowUp01Icon} />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={`Descer ${item.title}`}
                    disabled={
                      !canEdit ||
                      !!term ||
                      index === (items.data ?? []).length - 1
                    }
                    onClick={() => void move(index, 1)}
                  >
                    <SteelIcon icon={ArrowDown01Icon} />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={`Editar ${item.title}`}
                    disabled={!canEdit}
                    onClick={() => setEditing(item)}
                  >
                    <SteelIcon icon={PencilEdit02Icon} />
                  </Button>
                  {canDelete ? (
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      aria-label={`Excluir ${item.title}`}
                      onClick={() => void remove(item)}
                    >
                      <SteelIcon icon={Delete02Icon} />
                    </Button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {editing && collection.data ? (
        <CollectionItemDialog
          key={editing === 'new' ? 'new' : editing.id}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          workspaceId={workspaceId}
          siteId={siteId}
          collection={collection.data}
          item={editing === 'new' ? undefined : editing}
          onSubmit={submit}
        />
      ) : null}
    </div>
  )
}
