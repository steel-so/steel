'use client'

import {
  ArrowDown01Icon,
  Bookmark01Icon,
  Delete02Icon,
  FloppyDiskIcon,
  StarIcon,
  UserMultiple02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useCreateSdSavedView,
  useDeleteSdSavedView,
  useSdSavedViews,
  useUpdateSdSavedView,
} from '@/src/hooks/use-sd-tickets'
import type { SdSavedViewDTO, SdTicketTypeDTO } from '@/types/sd-ticket'
import { type SdBoardState, sdViewDirty, sdViewPayload } from './sd-board-state'

/** Chave da visão padrão (estrela) — preferência deste navegador. */
export function sdDefaultViewKey(workspaceId: string, boardKey: string) {
  return `sd-default-view:${workspaceId}:${boardKey}`
}

export function sdReadDefaultView(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeDefaultView(key: string, id: string | null) {
  try {
    if (id) window.localStorage.setItem(key, id)
    else window.localStorage.removeItem(key)
  } catch {
    // Sem storage: a estrela vale só nesta sessão.
  }
}

/** Visões do quadro: as do mesmo tipo (quadro "Todos" = sem tipo). */
export function sdBoardViews(
  views: SdSavedViewDTO[],
  ticketType: SdTicketTypeDTO | null,
): SdSavedViewDTO[] {
  return views
    .filter((v) => (v.ticketType ?? null) === ticketType)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
}

/**
 * Visões salvas (pessoais e compartilhadas): aplicar, salvar a atual,
 * atualizar a aplicada, excluir e marcar a padrão (estrela).
 */
export function SdSavedViewsMenu({
  workspaceId,
  boardKey,
  ticketType,
  state,
  columns,
  isAdmin,
  onApply,
}: {
  workspaceId: string
  boardKey: string
  ticketType: SdTicketTypeDTO | null
  state: SdBoardState
  /** Colunas visíveis da tabela (salvas junto). */
  columns: string[]
  isAdmin: boolean
  onApply: (view: SdSavedViewDTO | null) => void
}) {
  const { data = [] } = useSdSavedViews(workspaceId)
  const create = useCreateSdSavedView(workspaceId)
  const update = useUpdateSdSavedView(workspaceId)
  const remove = useDeleteSdSavedView(workspaceId)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const defaultKey = sdDefaultViewKey(workspaceId, boardKey)
  const [defaultId, setDefaultId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : sdReadDefaultView(defaultKey),
  )

  const views = sdBoardViews(data, ticketType)
  const mine = views.filter((v) => !v.shared)
  const sharedViews = views.filter((v) => v.shared)
  const current = views.find((v) => v.id === state.viewId) ?? null
  const dirty = current ? sdViewDirty(current, state) : false

  function toggleDefault(view: SdSavedViewDTO) {
    const next = defaultId === view.id ? null : view.id
    writeDefaultView(defaultKey, next)
    setDefaultId(next)
    notify.success(
      next
        ? `“${view.name}” abre por padrão neste quadro.`
        : 'Visão padrão removida.',
    )
  }

  function saveNew() {
    if (!name.trim()) return
    create.mutate(
      {
        name: name.trim(),
        ticketType,
        shared,
        columns,
        ...sdViewPayload(state),
      },
      {
        onSuccess: (view) => {
          notify.success('Visão salva.')
          setSaving(false)
          setName('')
          setShared(false)
          onApply(view)
        },
        onError: notify.error,
      },
    )
  }

  function saveCurrent() {
    if (!current) return
    update.mutate(
      { id: current.id, columns, ...sdViewPayload(state) },
      {
        onSuccess: () => notify.success('Visão atualizada.'),
        onError: notify.error,
      },
    )
  }

  function renderView(view: SdSavedViewDTO) {
    const selected = view.id === state.viewId
    return (
      <div
        key={view.id}
        className={cn(
          'group flex items-center gap-1 rounded-md pr-1 hover:bg-muted',
          selected && 'bg-muted',
        )}
      >
        <button
          type='button'
          className='flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm'
          onClick={() => {
            onApply(view)
            setOpen(false)
          }}
        >
          <SteelIcon
            icon={view.shared ? UserMultiple02Icon : Bookmark01Icon}
            strokeWidth={2}
            className='size-3.5 shrink-0 text-muted-foreground'
          />
          <span className='truncate'>{view.name}</span>
        </button>
        <button
          type='button'
          aria-label={
            defaultId === view.id
              ? `Remover “${view.name}” como padrão`
              : `Definir “${view.name}” como padrão`
          }
          aria-pressed={defaultId === view.id}
          onClick={() => toggleDefault(view)}
          className={cn(
            'rounded p-1 text-muted-foreground hover:text-highlight',
            defaultId === view.id
              ? 'text-highlight'
              : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <SteelIcon
            icon={StarIcon}
            strokeWidth={2}
            className='size-3.5'
            fill={defaultId === view.id ? 'currentColor' : 'none'}
          />
        </button>
        {view.editable ? (
          <button
            type='button'
            aria-label={`Excluir “${view.name}”`}
            onClick={() =>
              remove.mutate(view.id, {
                onSuccess: () => {
                  if (selected) onApply(null)
                  notify.success('Visão excluída.')
                },
                onError: notify.error,
              })
            }
            className='rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100'
          >
            <SteelIcon
              icon={Delete02Icon}
              strokeWidth={2}
              className='size-3.5'
            />
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant='outline'
              size='sm'
              aria-label='Visões salvas'
              data-tour='sd-board-views'
            >
              <SteelIcon icon={Bookmark01Icon} strokeWidth={2} />
              <span className='max-w-36 truncate'>
                {current ? current.name : 'Visões'}
              </span>
              {dirty ? (
                <span
                  className='size-1.5 rounded-full bg-highlight'
                  title='Alterada'
                />
              ) : null}
              <SteelIcon
                icon={ArrowDown01Icon}
                strokeWidth={2}
                className='size-3.5 text-muted-foreground'
              />
            </Button>
          }
        />
        <PopoverContent align='end' className='w-72 gap-1 p-2'>
          <button
            type='button'
            onClick={() => {
              onApply(null)
              setOpen(false)
            }}
            className={cn(
              'rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
              !state.viewId && 'bg-muted font-medium',
            )}
          >
            Padrão do quadro
          </button>
          <p className='px-2 pt-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wide'>
            Minhas visões
          </p>
          {mine.length ? (
            mine.map(renderView)
          ) : (
            <p className='px-2 py-1 text-muted-foreground text-xs'>
              Nenhuma ainda.
            </p>
          )}
          <p className='px-2 pt-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wide'>
            Compartilhadas
          </p>
          {sharedViews.length ? (
            sharedViews.map(renderView)
          ) : (
            <p className='px-2 py-1 text-muted-foreground text-xs'>
              Nenhuma compartilhada.
            </p>
          )}
          <div className='mt-2 flex flex-col gap-1 border-t pt-2'>
            {current?.editable && dirty ? (
              <Button
                variant='ghost'
                size='sm'
                className='justify-start'
                onClick={saveCurrent}
                disabled={update.isPending}
              >
                <SteelIcon icon={FloppyDiskIcon} strokeWidth={2} />
                Atualizar “{current.name}”
              </Button>
            ) : null}
            <Button
              variant='ghost'
              size='sm'
              className='justify-start'
              onClick={() => {
                setOpen(false)
                setSaving(true)
              }}
            >
              <SteelIcon icon={FloppyDiskIcon} strokeWidth={2} />
              Salvar como nova visão…
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={saving} onOpenChange={setSaving}>
        <DialogContent className='sm:max-w-sm'>
          <DialogHeader>
            <DialogTitle>Salvar visão</DialogTitle>
            <DialogDescription>
              Guarda o modo, os filtros, a ordenação e as colunas atuais.
            </DialogDescription>
          </DialogHeader>
          <form
            id='sd-save-view'
            className='flex flex-col gap-3'
            onSubmit={(e) => {
              e.preventDefault()
              saveNew()
            }}
          >
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='sd-view-name'>Nome</Label>
              <Input
                id='sd-view-name'
                value={name}
                maxLength={80}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                placeholder='Ex.: Críticos do meu time'
              />
            </div>
            {/* biome-ignore lint/a11y/noLabelWithoutControl: o Checkbox é o controle */}
            <label className='flex items-center gap-2 text-sm'>
              <Checkbox
                checked={shared}
                onCheckedChange={(checked) => setShared(Boolean(checked))}
              />
              Compartilhar com a equipe
              {!isAdmin ? (
                <span className='text-muted-foreground text-xs'>
                  (só você e admins editam)
                </span>
              ) : null}
            </label>
          </form>
          <DialogFooter>
            <Button variant='outline' onClick={() => setSaving(false)}>
              Cancelar
            </Button>
            <Button
              type='submit'
              form='sd-save-view'
              disabled={!name.trim() || create.isPending}
            >
              {create.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
