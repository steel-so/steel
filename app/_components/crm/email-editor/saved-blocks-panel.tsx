'use client'

import {
  BookmarkAdd01Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { type FormEvent, useMemo, useState } from 'react'
import { useCanvasDraggable } from '@/app/_components/canvas/dnd/canvas-dnd'
import { normalizeSearch } from '@/app/_components/canvas/lib/palette'
import { PaletteSearch } from '@/app/_components/canvas/sidebar/palette'
import {
  useCanvasNode,
  useCanvasStore,
} from '@/app/_components/canvas/use-canvas'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useCreateCrmEmailSavedBlock,
  useCrmEmailSavedBlocks,
  useDeleteCrmEmailSavedBlock,
  useUpdateCrmEmailSavedBlock,
} from '@/src/hooks/use-crm-email-editor'
import type { CanvasStore } from '@/src/lib/canvas/store'
import { fragmentKindOf } from '@/src/lib/canvas-email/fragments'
import { EMAIL_SAVED_BLOCK_CATEGORIES } from '@/src/schemas/crm-email-editor.schema'
import type { CrmEmailSavedBlockDTO } from '@/types/crm-email-editor'
import { useEmailEditorData } from './editor-data'
import { insertFragmentByClick } from './fragment-insert'
import { FragmentThumbnail } from './fragment-thumbnail'
import { OptionSelect } from './option-select'

const CATEGORY_OPTIONS = EMAIL_SAVED_BLOCK_CATEGORIES.map((category) => ({
  value: category,
  label: category,
}))

/** Name + category form, for saving and for renaming. */
function BlockForm({
  initialName,
  initialCategory,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initialName: string
  initialCategory: string
  submitLabel: string
  pending: boolean
  onSubmit: (data: { name: string; category: string }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  const [category, setCategory] = useState(initialCategory)
  const options = CATEGORY_OPTIONS.some((o) => o.value === category)
    ? CATEGORY_OPTIONS
    : [...CATEGORY_OPTIONS, { value: category, label: category }]
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    onSubmit({ name: name.trim(), category })
  }
  return (
    <form onSubmit={submit} className='flex flex-col gap-4'>
      <div className='flex flex-col gap-1.5'>
        <label htmlFor='saved-block-name' className='text-sm font-medium'>
          Nome
        </label>
        <Input
          id='saved-block-name'
          value={name}
          maxLength={80}
          autoFocus
          placeholder='Ex.: Cabeçalho com logo'
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className='flex flex-col gap-1.5'>
        <span className='text-sm font-medium'>Categoria</span>
        <OptionSelect
          label='Categoria'
          value={category}
          options={options}
          onChange={setCategory}
          className='h-9 text-sm'
        />
      </div>
      <DialogFooter>
        <Button type='button' variant='outline' onClick={onCancel}>
          Cancelar
        </Button>
        <Button type='submit' disabled={pending || !name.trim()}>
          {pending ? 'Salvando…' : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

function SavedBlockCard({
  block,
  store,
  onRename,
  onDelete,
}: {
  block: CrmEmailSavedBlockDTO
  store: CanvasStore
  onRename: () => void
  onDelete: () => void
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useCanvasDraggable(
    `saved:${block.id}`,
    { kind: 'fragment', fragment: block.fragment, label: block.name },
  )
  const insert = () => {
    if (!insertFragmentByClick(store, block.fragment)) {
      notify.info(`Não há onde inserir “${block.name}” neste e-mail.`)
    }
  }
  return (
    <div className='group relative'>
      <button
        type='button'
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        onClick={insert}
        data-testid={`saved-block-${block.id}`}
        aria-label={`${block.name} — arraste para o e-mail ou pressione Enter para inserir`}
        className={cn(
          'flex w-full cursor-grab touch-none flex-col overflow-hidden rounded-lg border bg-background text-left transition-[border-color,box-shadow] hover:border-primary/50 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing',
          isDragging && 'opacity-50',
        )}
      >
        <FragmentThumbnail
          fragment={block.fragment}
          className='aspect-[16/7]'
        />
        <span className='flex min-w-0 flex-col px-2.5 py-2'>
          <span className='truncate pr-6 text-xs font-medium'>
            {block.name}
          </span>
          <span className='truncate text-[11px] text-muted-foreground'>
            {block.kind === 'section' ? 'Seção' : 'Bloco'}
            {block.createdBy ? ` · ${block.createdBy.name}` : ''}
          </span>
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Ações de ${block.name}`}
          className='absolute right-1.5 bottom-2 flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none group-hover:opacity-100 data-[popup-open]:opacity-100'
        >
          <SteelIcon icon={MoreHorizontalIcon} className='size-4' />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-40'>
          <DropdownMenuItem onClick={onRename}>
            <SteelIcon icon={PencilEdit02Icon} />
            Renomear
          </DropdownMenuItem>
          <DropdownMenuItem variant='destructive' onClick={onDelete}>
            <SteelIcon icon={Delete02Icon} />
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * "Salvos" (E2): sections and blocks saved for the whole workspace. Save
 * the selection, search, rename, delete, and drag (or click) a block into
 * the e-mail exactly like a ready-made section.
 */
export function SavedBlocksPanel({ store }: { store: CanvasStore }) {
  const { workspaceId } = useEmailEditorData()
  const blocks = useCrmEmailSavedBlocks(workspaceId)
  const create = useCreateCrmEmailSavedBlock(workspaceId)
  const update = useUpdateCrmEmailSavedBlock(workspaceId)
  const remove = useDeleteCrmEmailSavedBlock(workspaceId)
  const selectedId = useCanvasStore((state) => state.selection[0] ?? null)
  const selected = useCanvasNode(selectedId ?? '')
  const selectedKind = fragmentKindOf(selected?.type)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [renaming, setRenaming] = useState<CrmEmailSavedBlockDTO | null>(null)
  const [deleting, setDeleting] = useState<CrmEmailSavedBlockDTO | null>(null)

  const groups = useMemo(() => {
    const term = normalizeSearch(query)
    const map = new Map<string, CrmEmailSavedBlockDTO[]>()
    for (const block of blocks.data ?? []) {
      if (
        term &&
        !normalizeSearch(`${block.name} ${block.category}`).includes(term)
      ) {
        continue
      }
      map.set(block.category, [...(map.get(block.category) ?? []), block])
    }
    return [...map.entries()]
  }, [blocks.data, query])

  const save = async (data: { name: string; category: string }) => {
    if (!selectedId) return
    const fragment = store.copy([selectedId])
    if (!fragment) return
    try {
      await create.mutateAsync({ ...data, fragment })
      setSaving(false)
      notify.success('Bloco salvo — já aparece para todo o workspace')
    } catch (error) {
      notify.error(error)
    }
  }

  const rename = async (data: { name: string; category: string }) => {
    if (!renaming) return
    try {
      await update.mutateAsync({ id: renaming.id, ...data })
      setRenaming(null)
    } catch (error) {
      notify.error(error)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await remove.mutateAsync(deleting.id)
      notify.success('Bloco excluído')
    } catch (error) {
      notify.error(error)
    } finally {
      setDeleting(null)
    }
  }

  const empty = !blocks.isLoading && (blocks.data?.length ?? 0) === 0

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex flex-col gap-2 p-3 pb-2'>
        <Button
          type='button'
          size='sm'
          variant='secondary'
          disabled={!selectedKind}
          onClick={() => setSaving(true)}
          data-testid='saved-block-save'
          title={
            selectedKind
              ? undefined
              : 'Selecione uma seção ou um bloco no e-mail'
          }
        >
          <SteelIcon icon={BookmarkAdd01Icon} strokeWidth={2} />
          {selectedKind === 'section'
            ? 'Salvar seção selecionada'
            : 'Salvar bloco selecionado'}
        </Button>
        {!empty ? (
          <PaletteSearch
            value={query}
            onChange={setQuery}
            placeholder='Buscar blocos salvos'
          />
        ) : null}
      </div>
      <div className='min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4'>
        {blocks.isLoading ? (
          <div className='grid gap-2'>
            <Skeleton className='h-28 w-full' />
            <Skeleton className='h-28 w-full' />
          </div>
        ) : null}
        {blocks.isError ? (
          <p className='px-1 py-8 text-center text-sm text-muted-foreground'>
            Não foi possível carregar os blocos salvos.
          </p>
        ) : null}
        {empty ? (
          <div className='flex flex-col items-center gap-2 px-2 py-8 text-center'>
            <span className='flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground'>
              <SteelIcon icon={BookmarkAdd01Icon} className='size-5' />
            </span>
            <p className='text-sm font-medium'>Nenhum bloco salvo ainda</p>
            <p className='text-xs text-muted-foreground'>
              Selecione uma seção ou um bloco no e-mail e salve para usar em
              qualquer template do workspace.
            </p>
          </div>
        ) : null}
        {!empty && !blocks.isLoading && groups.length === 0 ? (
          <p className='px-1 py-8 text-center text-sm text-muted-foreground'>
            Nenhum bloco encontrado.
          </p>
        ) : null}
        {groups.map(([category, items]) => (
          <section key={category}>
            <h3 className='px-0.5 pt-2 pb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase'>
              {category}
            </h3>
            <div className='grid gap-2'>
              {items.map((block) => (
                <SavedBlockCard
                  key={block.id}
                  block={block}
                  store={store}
                  onRename={() => setRenaming(block)}
                  onDelete={() => setDeleting(block)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <Dialog open={saving} onOpenChange={setSaving}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>
              {selectedKind === 'section' ? 'Salvar seção' : 'Salvar bloco'}
            </DialogTitle>
            <DialogDescription>
              Fica disponível em “Salvos” para todos os templates do workspace.
              Mudanças depois não alteram e-mails que já usam o bloco.
            </DialogDescription>
          </DialogHeader>
          {saving ? (
            <BlockForm
              initialName=''
              initialCategory={
                selectedKind === 'section' ? 'Conteúdo' : 'Outros'
              }
              submitLabel='Salvar'
              pending={create.isPending}
              onSubmit={save}
              onCancel={() => setSaving(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>Renomear bloco</DialogTitle>
            <DialogDescription>
              O novo nome vale para todo o workspace.
            </DialogDescription>
          </DialogHeader>
          {renaming ? (
            <BlockForm
              initialName={renaming.name}
              initialCategory={renaming.category}
              submitLabel='Salvar'
              pending={update.isPending}
              onSubmit={rename}
              onCancel={() => setRenaming(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              O bloco sai de “Salvos” para todo o workspace. Os e-mails que já
              usam este bloco não mudam.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={remove.isPending}
              data-testid='saved-block-confirm-delete'
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
