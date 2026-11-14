'use client'

import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  FloppyDiskIcon,
  Loading03Icon,
  ViewIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import dynamic from 'next/dynamic'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useCreateWhiteboardVersion,
  useRestoreWhiteboardVersion,
  useWhiteboard,
  useWhiteboardVersion,
  useWhiteboardVersions,
} from '@/src/hooks/use-whiteboard'
import type { WhiteboardDTO } from '@/types/whiteboard'
import type {
  WhiteboardCanvasController,
  WhiteboardCanvasState,
} from './whiteboard-canvas'
import { boardTitle } from './whiteboard-format'
import { WhiteboardHistoryPanel } from './whiteboard-history-panel'
import { WhiteboardRenameDialog } from './whiteboard-rename-dialog'
import { useWhiteboardSession, writeLastBoard } from './whiteboard-session'

// Excalidraw touches `window` on import: client only, in its own chunk.
const WhiteboardCanvas = dynamic(() => import('./whiteboard-canvas'), {
  ssr: false,
  loading: () => <Skeleton className='size-full rounded-none' />,
})

const STATUS: Record<
  WhiteboardCanvasState['status'],
  { label: string; icon: typeof Clock01Icon; tone?: string }
> = {
  loading: { label: 'Abrindo…', icon: Loading03Icon },
  saved: { label: 'Salvo', icon: CheckmarkCircle02Icon },
  saving: { label: 'Salvando…', icon: Loading03Icon },
  dirty: { label: 'Alterações não salvas', icon: Clock01Icon },
  error: {
    label: 'Erro ao salvar',
    icon: Alert02Icon,
    tone: 'text-destructive',
  },
  conflict: {
    label: 'Versão desatualizada',
    icon: Alert02Icon,
    tone: 'text-destructive',
  },
  readonly: { label: 'Somente leitura', icon: ViewIcon },
}

/**
 * A board: top bar (name, save state, "Salvar versão", "Histórico") over
 * the full-size canvas. One editor at a time — the others watch read-only
 * and take over when the lease frees up.
 */
export function WhiteboardEditor({
  initialBoard,
}: {
  initialBoard: WhiteboardDTO
}) {
  const { workspaceId, canEdit: roleCanEdit } = useWhiteboardSession()
  const { data: board = initialBoard } = useWhiteboard(
    workspaceId,
    initialBoard.id,
    initialBoard,
  )
  const controller = useRef<WhiteboardCanvasController | null>(null)
  const [state, setState] = useState<WhiteboardCanvasState>({
    status: 'loading',
    canEdit: false,
    lockedBy: null,
    readOnlyRole: !roleCanEdit,
  })
  const [renaming, setRenaming] = useState(false)
  const [savingVersion, setSavingVersion] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => {
    writeLastBoard(workspaceId, initialBoard.id)
  }, [workspaceId, initialBoard.id])

  const onState = useCallback((next: WhiteboardCanvasState) => {
    setState(next)
  }, [])
  const onController = useCallback((next: WhiteboardCanvasController) => {
    controller.current = next
  }, [])

  const status = STATUS[state.status]
  const title = boardTitle(board.title)

  return (
    <div className='flex h-full min-h-0 w-full min-w-0 flex-col'>
      <div className='flex min-h-12 flex-wrap items-center gap-2 border-b px-3 py-1.5'>
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          {roleCanEdit && !board.archivedAt ? (
            <button
              type='button'
              onClick={() => setRenaming(true)}
              title='Renomear'
              className='min-w-0 truncate rounded px-1 font-semibold text-sm hover:bg-muted'
            >
              {title}
            </button>
          ) : (
            <h1 className='min-w-0 truncate px-1 font-semibold text-sm'>
              {title}
            </h1>
          )}
          <span
            role='status'
            data-tour='whiteboard-status'
            className={cn(
              'flex shrink-0 items-center gap-1 text-muted-foreground text-xs',
              status.tone,
            )}
          >
            <SteelIcon icon={status.icon} size={14} strokeWidth={2} />
            <span className='max-sm:sr-only'>{status.label}</span>
          </span>
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          {state.canEdit && (
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setSavingVersion(true)}
            >
              <SteelIcon icon={FloppyDiskIcon} strokeWidth={2} />
              <span className='max-sm:sr-only'>Salvar versão</span>
            </Button>
          )}
          <Button
            variant='outline'
            size='sm'
            data-tour='whiteboard-history'
            onClick={() => setHistoryOpen(true)}
          >
            <SteelIcon icon={Clock01Icon} strokeWidth={2} />
            <span className='max-sm:sr-only'>Histórico</span>
          </Button>
        </div>
      </div>
      {state.lockedBy && !state.readOnlyRole && (
        <p className='border-b bg-muted px-3 py-1.5 text-muted-foreground text-xs'>
          {state.lockedBy.holder.name} está editando este quadro. Você acompanha
          as mudanças e assume a edição quando a pessoa sair.
        </p>
      )}
      {board.archivedAt && (
        <p className='border-b bg-muted px-3 py-1.5 text-muted-foreground text-xs'>
          Quadro arquivado: restaure-o na lista para voltar a editar.
        </p>
      )}
      {state.status === 'conflict' && (
        <div className='flex flex-wrap items-center gap-2 border-b bg-muted px-3 py-1.5 text-xs'>
          <span>Outra pessoa alterou este quadro enquanto você editava.</span>
          <Button
            size='sm'
            variant='outline'
            onClick={() => window.location.reload()}
          >
            Recarregar
          </Button>
        </div>
      )}
      {/* The canvas owns the keyboard: Excalidraw's single-key tools
          (R, H, 1–9…) must not trigger the app's "G → …" navigation. */}
      <div
        data-shortcuts-trap
        data-tour='whiteboard-canvas'
        className='relative min-h-0 flex-1'
      >
        <WhiteboardCanvas
          key={initialBoard.id}
          board={initialBoard}
          workspaceId={workspaceId}
          roleCanEdit={roleCanEdit}
          onState={onState}
          onController={onController}
        />
      </div>
      <WhiteboardRenameDialog
        workspaceId={workspaceId}
        board={renaming ? board : null}
        onOpenChange={setRenaming}
      />
      <SaveVersionDialog
        open={savingVersion}
        onOpenChange={setSavingVersion}
        boardId={board.id}
        flush={() => controller.current?.flush() ?? Promise.resolve()}
      />
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side='right' className='w-full gap-0 sm:max-w-md'>
          <SheetHeader>
            <SheetTitle>Histórico</SheetTitle>
            <SheetDescription>
              Versões automáticas a cada 10 minutos de edição (as 50 mais
              recentes) e todas as que alguém salvou ou restaurou.
            </SheetDescription>
          </SheetHeader>
          <div className='min-h-0 flex-1 overflow-y-auto px-4 pb-4'>
            {historyOpen && (
              <WhiteboardHistory
                boardId={board.id}
                canRestore={state.canEdit && !board.archivedAt}
                blockedReason={
                  state.readOnlyRole
                    ? null
                    : state.lockedBy
                      ? `${state.lockedBy.holder.name} está editando agora.`
                      : null
                }
                controller={controller}
                onRestored={() => setHistoryOpen(false)}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function WhiteboardHistory({
  boardId,
  canRestore,
  blockedReason,
  controller,
  onRestored,
}: {
  boardId: string
  canRestore: boolean
  blockedReason: string | null
  controller: React.RefObject<WhiteboardCanvasController | null>
  onRestored: () => void
}) {
  const { workspaceId } = useWhiteboardSession()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const versions = useWhiteboardVersions(workspaceId, boardId)
  const selected = useWhiteboardVersion(workspaceId, boardId, selectedId)
  const restore = useRestoreWhiteboardVersion(workspaceId, boardId)
  const previewRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = previewRef.current
    const scene = selected.data?.scene
    if (!host || !scene || !controller.current) return
    let alive = true
    host.replaceChildren()
    void controller.current.renderPreview(scene).then((svg) => {
      if (alive) host.replaceChildren(svg)
    })
    return () => {
      alive = false
    }
  }, [selected.data, controller])

  async function handleRestore(version: { id: string }) {
    await controller.current?.flush()
    restore.mutate(version.id, {
      onSuccess: (board) => {
        controller.current?.load(board)
        notify.success('Versão restaurada')
        onRestored()
      },
      onError: notify.error,
    })
  }

  return (
    <WhiteboardHistoryPanel
      versions={versions.data}
      isLoading={versions.isLoading}
      canRestore={canRestore}
      restoreBlockedReason={blockedReason}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onRestore={handleRestore}
      restoring={restore.isPending}
      preview={
        selected.isLoading ? (
          <Skeleton className='size-full' />
        ) : (
          <div ref={previewRef} className='size-full' />
        )
      }
    />
  )
}

function SaveVersionDialog({
  open,
  onOpenChange,
  boardId,
  flush,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  boardId: string
  flush: () => Promise<void>
}) {
  const { workspaceId } = useWhiteboardSession()
  const [name, setName] = useState('')
  const create = useCreateWhiteboardVersion(workspaceId, boardId)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    await flush()
    create.mutate(name.trim() ? { name: name.trim() } : {}, {
      onSuccess: () => {
        notify.success('Versão salva no histórico')
        setName('')
        onOpenChange(false)
      },
      onError: notify.error,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className='space-y-4'>
          <DialogHeader>
            <DialogTitle>Salvar versão</DialogTitle>
            <DialogDescription>
              Marca o estado atual do quadro no histórico. Versões salvas não
              são apagadas.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-2'>
            <Label htmlFor='whiteboard-version-name'>Nome (opcional)</Label>
            <Input
              id='whiteboard-version-name'
              value={name}
              maxLength={80}
              placeholder='Ex.: Proposta enviada ao cliente'
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type='submit' disabled={create.isPending}>
              Salvar versão
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
