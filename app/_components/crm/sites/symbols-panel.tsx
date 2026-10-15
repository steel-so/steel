'use client'

import {
  ArrowLeft01Icon,
  Delete02Icon,
  PencilEdit02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useMemo, useState } from 'react'
import { useCanvasEditor } from '@/app/_components/canvas/editor-context'
import { PresetCard } from '@/app/_components/canvas/sidebar/presets'
import { useCanvasStore } from '@/app/_components/canvas/use-canvas'
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
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify'
import { getNode, parentOf } from '@/src/lib/canvas/ops'
import {
  symbolDocumentFrom,
  symbolInstanceFragment,
  symbolSourceOf,
} from '@/src/lib/sites/symbols'
import type { SiteGlobalDTO } from '@/types/site'
import { useSiteEditor } from './site-editor-context'
import { useOpenTarget } from './use-open-target'

/** Miniature of a component's master. */
function SymbolPreview({ global }: { global: SiteGlobalDTO }) {
  const { theme, pageLinks } = useSiteEditor()
  const docs = useMemo(() => [global.document], [global.document])
  const context = useMemo(() => ({ pages: pageLinks }), [pageLinks])
  return (
    <SiteSnapshot
      docs={docs}
      theme={theme}
      context={context}
      className='size-full self-stretch bg-white'
    />
  )
}

/** Turns the selected section into a reusable component: the master keeps
 * a copy and the section becomes its first instance (one undo step). */
function CreateFromSelection() {
  const { site, api, globals, setGlobals, target } = useSiteEditor()
  const { store } = useCanvasEditor()
  const doc = useCanvasStore((state) => state.doc)
  const selection = useCanvasStore((state) => state.selection)
  const source = target.kind === 'page' ? symbolSourceOf(doc, selection) : null
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  if (!source) {
    return (
      <p className='rounded-lg border border-dashed p-3 text-muted-foreground text-xs'>
        Selecione uma seção da página para transformá-la num componente
        reutilizável.
      </p>
    )
  }

  async function create(event: React.FormEvent) {
    event.preventDefault()
    if (!source) return
    const label = name.trim() || 'Componente'
    setBusy(true)
    try {
      const current = store.getState().doc
      const global = await api.createGlobal(site.id, {
        kind: 'SYMBOL',
        name: label,
        document: symbolDocumentFrom(current, source),
      })
      setGlobals([...globals, global])
      const parentId = parentOf(current, source)
      const index = parentId
        ? (getNode(current, parentId)?.children ?? []).indexOf(source)
        : -1
      if (parentId && index >= 0) {
        store.dispatch(
          {
            kind: 'batch',
            label: 'Criar componente',
            ops: [
              {
                kind: 'insert',
                fragment: symbolInstanceFragment(global.id),
                at: { parentId, index },
              },
              { kind: 'remove', id: source },
            ],
          },
          { coalesce: false },
        )
      }
      setName('')
      notify.success(`“${label}” agora é um componente reutilizável.`)
    } catch (error) {
      notify.error(error, 'Não foi possível criar o componente')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={create}
      className='grid gap-2 rounded-lg border p-3'
      aria-label='Criar componente reutilizável'
    >
      <p className='font-medium text-xs'>Criar a partir da seção selecionada</p>
      <Input
        value={name}
        maxLength={120}
        placeholder='Nome (ex.: Chamada para contato)'
        aria-label='Nome do componente'
        onChange={(event) => setName(event.target.value)}
      />
      <Button type='submit' size='xs' disabled={busy}>
        Criar componente
      </Button>
    </form>
  )
}

function SymbolCard({
  global,
  draggable,
  onRemove,
}: {
  global: SiteGlobalDTO
  draggable: boolean
  onRemove: () => void
}) {
  const { site, api, globals, setGlobals, canEdit } = useSiteEditor()
  const openTarget = useOpenTarget()
  const [renaming, setRenaming] = useState<string | null>(null)
  const preset = useMemo(
    () => ({
      id: `symbol-${global.id}`,
      label: global.name,
      category: 'Componentes',
      preview: () => <SymbolPreview global={global} />,
      fragment: () => symbolInstanceFragment(global.id),
    }),
    [global],
  )

  async function rename(event: React.FormEvent) {
    event.preventDefault()
    const name = renaming?.trim()
    setRenaming(null)
    if (!name || name === global.name) return
    try {
      const saved = await api.updateGlobal(site.id, global.id, { name })
      setGlobals(globals.map((item) => (item.id === saved.id ? saved : item)))
    } catch (error) {
      notify.error(error, 'Não foi possível renomear')
    }
  }

  return (
    <li className='grid gap-1.5' data-testid={`symbol-${global.id}`}>
      {draggable ? (
        <PresetCard preset={preset} />
      ) : (
        <div className='overflow-hidden rounded-lg border'>
          <div className='aspect-[16/7] w-full bg-muted/60'>
            <SymbolPreview global={global} />
          </div>
          <p className='truncate px-2.5 py-2 font-medium text-xs'>
            {global.name}
          </p>
        </div>
      )}
      {canEdit ? (
        renaming !== null ? (
          <form onSubmit={rename} className='flex gap-1'>
            <Input
              autoFocus
              value={renaming}
              maxLength={120}
              aria-label='Novo nome do componente'
              onChange={(event) => setRenaming(event.target.value)}
              onBlur={(event) => void rename(event)}
              className='h-7 text-xs'
            />
          </form>
        ) : (
          <div className='flex items-center gap-0.5'>
            <Button
              size='xs'
              variant='ghost'
              onClick={() => void openTarget({ kind: 'global', id: global.id })}
            >
              <SteelIcon icon={PencilEdit02Icon} data-icon='inline-start' />
              Editar
            </Button>
            <Button
              size='xs'
              variant='ghost'
              onClick={() => setRenaming(global.name)}
            >
              Renomear
            </Button>
            <button
              type='button'
              onClick={onRemove}
              aria-label={`Excluir ${global.name}`}
              title='Excluir'
              className='ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
            >
              <SteelIcon icon={Delete02Icon} className='size-3.5' />
            </button>
          </div>
        )
      ) : null}
    </li>
  )
}

/**
 * "Componentes": reusable components of the site (SYMBOL globals). Drag one
 * into a page (or click to insert) to add an instance; editing the master
 * updates every instance, and each instance may override its texts in the
 * inspector.
 */
export function SymbolsPanel() {
  const { site, api, globals, setGlobals, target, lastPageId } = useSiteEditor()
  const openTarget = useOpenTarget()
  const [removing, setRemoving] = useState<SiteGlobalDTO | null>(null)
  const symbols = globals.filter((global) => global.kind === 'SYMBOL')
  const editing = symbols.find(
    (global) => target.kind === 'global' && global.id === target.id,
  )

  async function confirmRemove() {
    if (!removing) return
    const global = removing
    setRemoving(null)
    try {
      if (editing?.id === global.id) {
        await openTarget({ kind: 'page', id: lastPageId })
      }
      await api.removeGlobal(site.id, global.id)
      setGlobals(globals.filter((item) => item.id !== global.id))
      notify.success('Componente excluído.')
    } catch (error) {
      notify.error(error, 'Não foi possível excluir o componente')
    }
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col' data-testid='symbols-panel'>
      <div className='min-h-0 flex-1 space-y-4 overflow-y-auto p-3'>
        {editing ? (
          <div className='grid gap-2 rounded-lg bg-primary/10 p-3 text-primary text-xs'>
            <p>
              Você está editando “{editing.name}”: as mudanças aparecem em todas
              as cópias, nas páginas, ao salvar.
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
        ) : (
          <CreateFromSelection />
        )}
        {symbols.length === 0 ? (
          <p className='px-1 py-6 text-center text-muted-foreground text-sm'>
            Nenhum componente reutilizável ainda.
          </p>
        ) : (
          <ul className='grid gap-3' aria-label='Componentes reutilizáveis'>
            {symbols.map((global) => (
              <SymbolCard
                key={global.id}
                global={global}
                draggable={!editing}
                onRemove={() => setRemoving(global)}
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
            <AlertDialogTitle>Excluir “{removing?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              As cópias nas páginas deixam de aparecer no rascunho agora e no
              site no ar na próxima publicação. Você pode recuperá-lo
              restaurando uma versão.
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
