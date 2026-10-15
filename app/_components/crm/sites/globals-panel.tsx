'use client'

import {
  ArrowLeft01Icon,
  Delete02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useMemo, useState } from 'react'
import { SiteSnapshot } from '@/app/_components/canvas-site/site-snapshot'
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
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { SITE_KITS, type SiteKitId } from '@/src/lib/canvas-site/presets/kits'
import { buildSiteGlobal } from '@/src/lib/sites/templates'
import type { SiteGlobalDTO, SiteGlobalKindDTO } from '@/types/site'
import { useSiteEditor } from './site-editor-context'
import { useOpenTarget } from './use-open-target'

type Kind = Exclude<SiteGlobalKindDTO, 'SYMBOL' | 'TEMPLATE'>

const COPY: Record<Kind, { title: string; name: string; hint: string }> = {
  HEADER: {
    title: 'Cabeçalho',
    name: 'Cabeçalho',
    hint: 'Logo e menu no topo de todas as páginas.',
  },
  FOOTER: {
    title: 'Rodapé',
    name: 'Rodapé',
    hint: 'Contato, links e redes no fim de todas as páginas.',
  },
}

function CreateGlobal({ kind }: { kind: Kind }) {
  const { site, api, globals, setGlobals, canEdit } = useSiteEditor()
  const openTarget = useOpenTarget()
  const [busy, setBusy] = useState(false)

  async function create(kit?: SiteKitId) {
    setBusy(true)
    try {
      const global = await api.createGlobal(site.id, {
        kind,
        name: COPY[kind].name,
        document: buildSiteGlobal(kind, kit),
      })
      setGlobals([...globals, global])
      await openTarget({ kind: 'global', id: global.id })
    } catch (error) {
      notify.error(error, 'Não foi possível criar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='grid gap-2 rounded-lg border border-dashed p-3'>
      <p className='text-muted-foreground text-xs'>
        Sem {COPY[kind].title.toLowerCase()}. Comece por um estilo:
      </p>
      <div className='grid grid-cols-2 gap-1.5'>
        {Object.values(SITE_KITS).map((kit) => (
          <Button
            key={kit.id}
            size='xs'
            variant='outline'
            disabled={busy || !canEdit}
            onClick={() => void create(kit.id)}
          >
            {kit.label}
          </Button>
        ))}
        <Button
          size='xs'
          variant='ghost'
          disabled={busy || !canEdit}
          onClick={() => void create()}
        >
          Em branco
        </Button>
      </div>
    </div>
  )
}

function GlobalCard({
  global,
  editing,
  onRemove,
}: {
  global: SiteGlobalDTO
  editing: boolean
  onRemove: () => void
}) {
  const { theme, pageLinks, canEdit } = useSiteEditor()
  const openTarget = useOpenTarget()
  const docs = useMemo(() => [global.document], [global.document])
  const context = useMemo(() => ({ pages: pageLinks }), [pageLinks])
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border transition-colors',
        editing && 'border-primary ring-2 ring-primary/20',
      )}
    >
      <button
        type='button'
        onClick={() => void openTarget({ kind: 'global', id: global.id })}
        aria-label={`Editar ${global.name}`}
        className='block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
      >
        <SiteSnapshot
          docs={docs}
          theme={theme}
          context={context}
          className='aspect-[4/1] bg-white'
        />
      </button>
      <div className='flex items-center justify-between gap-2 border-t px-2 py-1.5'>
        <span className='truncate font-medium text-xs'>
          {editing ? 'Editando agora' : 'Clique para editar'}
        </span>
        {canEdit ? (
          <button
            type='button'
            onClick={onRemove}
            aria-label={`Remover ${global.name}`}
            title='Remover'
            className='flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
          >
            <SteelIcon icon={Delete02Icon} className='size-3.5' />
          </button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * "Globais": the header and footer shared by every page. Editing one opens
 * it in the canvas; while a page is open they are drawn around it.
 */
export function GlobalsPanel() {
  const { site, globals, target, lastPageId, api, setGlobals } = useSiteEditor()
  const openTarget = useOpenTarget()
  const [removing, setRemoving] = useState<SiteGlobalDTO | null>(null)
  const editingGlobal = target.kind === 'global'

  async function confirmRemove() {
    if (!removing) return
    const global = removing
    setRemoving(null)
    try {
      if (target.kind === 'global' && target.id === global.id) {
        await openTarget({ kind: 'page', id: lastPageId })
      }
      await api.removeGlobal(site.id, global.id)
      setGlobals(globals.filter((item) => item.id !== global.id))
      notify.success(
        `${COPY[global.kind as Kind]?.title ?? global.name} removido.`,
      )
    } catch (error) {
      notify.error(error, 'Não foi possível remover')
    }
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col' data-testid='globals-panel'>
      <div className='min-h-0 flex-1 space-y-4 overflow-y-auto p-3'>
        {editingGlobal ? (
          <div className='grid gap-2 rounded-lg bg-primary/10 p-3 text-primary text-xs'>
            <p>
              Você está editando um componente global: as mudanças aparecem em
              todas as páginas.
            </p>
            <Button
              size='xs'
              variant='outline'
              onClick={() => void openTarget({ kind: 'page', id: lastPageId })}
            >
              <SteelIcon icon={ArrowLeft01Icon} data-icon='inline-start' />
              Voltar para a página
            </Button>
          </div>
        ) : null}
        {(['HEADER', 'FOOTER'] as const).map((kind) => {
          const global = globals.find((item) => item.kind === kind)
          return (
            <section key={kind} className='grid gap-2'>
              <div>
                <h3 className='font-medium text-sm'>{COPY[kind].title}</h3>
                <p className='text-muted-foreground text-xs'>
                  {COPY[kind].hint}
                </p>
              </div>
              {global ? (
                <GlobalCard
                  global={global}
                  editing={target.kind === 'global' && target.id === global.id}
                  onRemove={() => setRemoving(global)}
                />
              ) : (
                <CreateGlobal kind={kind} />
              )}
            </section>
          )
        })}
      </div>
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remover o {removing?.kind === 'FOOTER' ? 'rodapé' : 'cabeçalho'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Ele some de todas as páginas do rascunho agora e do site no ar na
              próxima publicação. Você pode recuperá-lo restaurando uma versão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => void confirmRemove()}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
