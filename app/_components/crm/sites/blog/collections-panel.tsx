'use client'

import {
  Add01Icon,
  MoreHorizontalIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { useCanvasEditor } from '@/app/_components/canvas/editor-context'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { crmSitesKeys } from '@/src/hooks/use-crm-sites'
import {
  siteBlogApi,
  siteBlogKeys,
  useSiteCollections,
} from '@/src/hooks/use-site-blog'
import type { SiteCollectionDTO } from '@/types/site-blog'
import { useSiteEditor } from '../site-editor-context'
import { useOpenTarget } from '../use-open-target'
import { CollectionDialog, type CollectionFormValue } from './collection-dialog'

/**
 * "Coleções" tab of the site editor: custom content types (cases, equipe,
 * vagas, imóveis…). Items are managed on their own screen; the item page
 * template opens in the canvas. Show a collection on any page with the
 * "Lista da coleção" element.
 */
export function CollectionsPanel() {
  const { workspaceId, slug, site, globals, setGlobals, canEdit, canDelete } =
    useSiteEditor()
  const { save } = useCanvasEditor()
  const openTarget = useOpenTarget()
  const router = useRouter()
  const queryClient = useQueryClient()
  const api = useMemo(
    () => siteBlogApi(workspaceId, site.id),
    [workspaceId, site.id],
  )
  const collections = useSiteCollections(workspaceId, site.id)
  const [editing, setEditing] = useState<SiteCollectionDTO | 'new' | null>(null)

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: siteBlogKeys.all(workspaceId, site.id),
    })

  async function submit(value: CollectionFormValue): Promise<boolean> {
    try {
      if (editing === 'new') {
        await api.createCollection(value)
        notify.success('Coleção criada.')
      } else if (editing) {
        await api.updateCollection(editing.id, value)
        notify.success('Coleção salva.')
      }
      await refresh()
      return true
    } catch (error) {
      notify.error(error, 'Não foi possível salvar a coleção')
      return false
    }
  }

  async function openTemplate(collection: SiteCollectionDTO) {
    try {
      const template = await api.ensureItemTemplate(collection.id)
      if (!globals.some((global) => global.id === template.id)) {
        setGlobals([...globals, template])
      }
      void queryClient.invalidateQueries({
        queryKey: crmSitesKeys.globals(workspaceId, site.id),
      })
      void refresh()
      await openTarget({ kind: 'global', id: template.id })
    } catch (error) {
      notify.error(error, 'Não foi possível abrir a página do item')
    }
  }

  async function remove(collection: SiteCollectionDTO) {
    if (
      !window.confirm(
        `Excluir a coleção ${collection.name} e os ${collection.itemCount} itens dela? Isso não pode ser desfeito.`,
      )
    ) {
      return
    }
    try {
      await api.removeCollection(collection.id)
      if (collection.templateGlobalId) {
        setGlobals(
          globals.filter((global) => global.id !== collection.templateGlobalId),
        )
      }
      await refresh()
      notify.success('Coleção excluída.')
    } catch (error) {
      notify.error(error, 'Não foi possível excluir a coleção')
    }
  }

  async function manageItems(collection: SiteCollectionDTO) {
    await save()
    router.push(`/${slug}/crm/sites/${site.id}/collections/${collection.id}`)
  }

  const list = collections.data ?? []

  return (
    <div
      className='flex flex-col gap-4 p-3'
      data-testid='site-collections-panel'
    >
      <div className='flex items-center justify-between gap-2'>
        <h2 className='font-semibold text-sm'>Coleções</h2>
        <Button
          size='sm'
          variant='outline'
          disabled={!canEdit}
          onClick={() => setEditing('new')}
        >
          <SteelIcon icon={Add01Icon} data-icon='inline-start' />
          Nova coleção
        </Button>
      </div>
      <p className='text-muted-foreground text-xs'>
        Conteúdos com campos próprios: casos, equipe, vagas, imóveis… Mostre em
        qualquer página com o elemento “Lista da coleção”.
      </p>
      {collections.isLoading ? (
        <div className='grid gap-2'>
          <Skeleton className='h-14' />
          <Skeleton className='h-14' />
        </div>
      ) : list.length === 0 ? (
        <p className='rounded-lg border border-dashed p-3 text-center text-muted-foreground text-xs'>
          Nenhuma coleção ainda.
        </p>
      ) : (
        <ul className='grid gap-2'>
          {list.map((collection) => (
            <li
              key={collection.id}
              className='flex items-center gap-2 rounded-lg border p-2'
            >
              <button
                type='button'
                className='grid min-w-0 flex-1 gap-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                onClick={() => void manageItems(collection)}
              >
                <span className='truncate font-medium text-sm'>
                  {collection.name}
                </span>
                <span className='truncate text-muted-foreground text-xs'>
                  {collection.itemCount === 1
                    ? '1 item'
                    : `${collection.itemCount} itens`}{' '}
                  · /{collection.slug}
                </span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      aria-label={`Ações de ${collection.name}`}
                    >
                      <SteelIcon icon={MoreHorizontalIcon} />
                    </Button>
                  }
                />
                <DropdownMenuContent align='end' className='w-56'>
                  <DropdownMenuItem
                    onClick={() => void manageItems(collection)}
                  >
                    Gerenciar itens
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!canEdit}
                    onClick={() => void openTemplate(collection)}
                  >
                    {collection.templateGlobalId
                      ? 'Editar página do item'
                      : 'Criar página do item'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!canEdit}
                    onClick={() => setEditing(collection)}
                  >
                    Editar campos
                  </DropdownMenuItem>
                  {canDelete ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant='destructive'
                        onClick={() => void remove(collection)}
                      >
                        Excluir coleção
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <CollectionDialog
          key={editing === 'new' ? 'new' : editing.id}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          collection={editing === 'new' ? undefined : editing}
          collections={list.filter(
            (item) => editing === 'new' || item.id !== editing.id,
          )}
          onSubmit={submit}
        />
      ) : null}
    </div>
  )
}
