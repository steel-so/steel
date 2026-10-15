'use client'

import {
  ArrowRight01Icon,
  LockIcon,
  SquareUnlock01Icon,
  ViewIcon,
  ViewOffIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { memo, useEffect, useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'
import { getNode, parentOf } from '@/src/lib/canvas/ops'
import type { CanvasNodeId } from '@/src/lib/canvas/types'
import { useCanvasDraggable } from '../dnd/canvas-dnd'
import { resolveIcon, useCanvasEditor, useDragState } from '../editor-context'
import { useCanvasNode, useCanvasStore } from '../use-canvas'

const INDENT = 14

function RenameInput({
  initial,
  onDone,
}: {
  initial: string
  onDone: (value: string | null) => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <input
      ref={ref}
      value={value}
      aria-label='Nome da camada'
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onDone(value)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') onDone(value)
        if (event.key === 'Escape') onDone(null)
      }}
      onPointerDown={(event) => event.stopPropagation()}
      className='h-6 min-w-0 flex-1 rounded border border-ring bg-background px-1.5 text-xs outline-none'
    />
  )
}

const LayerRow = memo(function LayerRow({
  id,
  depth,
  collapsed,
  toggle,
}: {
  id: CanvasNodeId
  depth: number
  collapsed: Set<CanvasNodeId>
  toggle: (id: CanvasNodeId) => void
}) {
  const { catalog, store } = useCanvasEditor()
  const node = useCanvasNode(id)
  const selected = useCanvasStore((state) => state.selection.includes(id))
  const hovered = useCanvasStore((state) => state.hovered === id)
  const isRoot = useCanvasStore((state) => state.doc.rootId === id)
  const hint = useDragState((state) =>
    state.layerHint?.id === id ? state.layerHint : null,
  )
  const [renaming, setRenaming] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const definition = node ? catalog.components[node.type] : undefined
  const label = node?.meta?.name ?? definition?.label ?? node?.type ?? ''
  const draggable = useCanvasDraggable(`layer:${id}`, {
    kind: 'node',
    id,
    label,
  })

  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (!node) return null
  const children = node.children ?? []
  const hasChildren = children.length > 0
  const open = !collapsed.has(id)
  const hidden = !!node.meta?.hidden
  const locked = !!node.meta?.locked
  const canDrag = !isRoot && !locked

  const setMeta = (set: Record<string, unknown>) =>
    store.dispatch({ kind: 'meta', id, set }, { label: 'meta' })

  return (
    <div role='none'>
      <div
        ref={(element) => {
          rowRef.current = element
          if (canDrag) draggable.setNodeRef(element)
        }}
        {...(canDrag ? draggable.attributes : {})}
        {...(canDrag ? draggable.listeners : {})}
        role='treeitem'
        aria-selected={selected}
        aria-expanded={hasChildren ? open : undefined}
        aria-level={depth + 1}
        tabIndex={selected ? 0 : -1}
        data-layer-id={id}
        data-testid={`layer-${id}`}
        onClick={(event) => {
          if (event.shiftKey || event.metaKey || event.ctrlKey) {
            const current = store.getState().selection
            store.select(
              current.includes(id)
                ? current.filter((item) => item !== id)
                : [...current, id],
            )
          } else {
            store.select(isRoot ? null : id)
          }
        }}
        onDoubleClick={() => !isRoot && setRenaming(true)}
        onPointerEnter={() => store.hover(id)}
        onPointerLeave={() => {
          if (store.getState().hovered === id) store.hover(null)
        }}
        className={cn(
          'group relative flex h-8 cursor-default items-center gap-1 rounded-md pr-1 text-xs outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50',
          selected
            ? 'bg-primary/10 text-foreground'
            : hovered
              ? 'bg-muted/70'
              : 'hover:bg-muted/70',
          hidden && 'text-muted-foreground',
          draggable.isDragging && 'opacity-40',
          hint?.position === 'inside' &&
            (hint.valid
              ? 'bg-primary/10 ring-2 ring-primary ring-inset'
              : 'ring-2 ring-destructive ring-inset'),
        )}
        style={{ paddingLeft: 4 + depth * INDENT }}
      >
        {hint && hint.position !== 'inside' && (
          <span
            data-testid='layer-drop-line'
            className={cn(
              'pointer-events-none absolute right-1 h-0.5 rounded-full',
              hint.valid ? 'bg-primary' : 'bg-destructive',
              hint.position === 'before' ? '-top-px' : '-bottom-px',
            )}
            style={{ left: 4 + depth * INDENT }}
          />
        )}
        <button
          type='button'
          tabIndex={-1}
          aria-label={open ? 'Recolher' : 'Expandir'}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            toggle(id)
          }}
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground',
            !hasChildren && 'invisible',
          )}
        >
          <SteelIcon
            icon={ArrowRight01Icon}
            className={cn('size-3.5 transition-transform', open && 'rotate-90')}
          />
        </button>
        <SteelIcon
          icon={resolveIcon(catalog, definition?.icon)}
          className={cn(
            'size-3.5 shrink-0',
            selected ? 'text-primary' : 'text-muted-foreground',
          )}
        />
        {renaming ? (
          <RenameInput
            initial={label}
            onDone={(value) => {
              setRenaming(false)
              if (value === null) return
              const name = value.trim()
              setMeta({
                name: name && name !== definition?.label ? name : undefined,
              })
            }}
          />
        ) : (
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              selected && 'font-medium',
              hidden && 'line-through decoration-muted-foreground/50',
            )}
          >
            {label}
          </span>
        )}
        {!isRoot && !renaming && (
          <span className='flex shrink-0 items-center'>
            <button
              type='button'
              tabIndex={-1}
              aria-label={hidden ? `Mostrar ${label}` : `Ocultar ${label}`}
              title={hidden ? 'Mostrar' : 'Ocultar'}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                setMeta({ hidden: hidden ? undefined : true })
              }}
              className={cn(
                'flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground',
                !hidden &&
                  'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              )}
            >
              <SteelIcon
                icon={hidden ? ViewOffIcon : ViewIcon}
                className='size-3.5'
              />
            </button>
            <button
              type='button'
              tabIndex={-1}
              aria-label={locked ? `Destravar ${label}` : `Travar ${label}`}
              title={locked ? 'Destravar' : 'Travar'}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                setMeta({ locked: locked ? undefined : true })
              }}
              className={cn(
                'flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground',
                !locked &&
                  'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              )}
            >
              <SteelIcon
                icon={locked ? LockIcon : SquareUnlock01Icon}
                className='size-3.5'
              />
            </button>
          </span>
        )}
      </div>
      {hasChildren && open && (
        <div>
          {children.map((child) => (
            <LayerRow
              key={child}
              id={child}
              depth={depth + 1}
              collapsed={collapsed}
              toggle={toggle}
            />
          ))}
        </div>
      )}
    </div>
  )
})

/** "Camadas": the document tree. Click selects, double-click renames, the
 * eye hides and the lock locks; rows drag to reorder or reparent. */
export function LayersPanel() {
  const { store } = useCanvasEditor()
  const rootId = useCanvasStore((state) => state.doc.rootId)
  const selection = useCanvasStore((state) => state.selection)
  const [collapsed, setCollapsed] = useState<Set<CanvasNodeId>>(() => new Set())

  // Reveal the selected node.
  useEffect(() => {
    const { doc } = store.getState()
    const ancestors: CanvasNodeId[] = []
    for (const id of selection) {
      for (let p = parentOf(doc, id); p !== null; p = parentOf(doc, p)) {
        ancestors.push(p)
      }
    }
    if (ancestors.some((id) => collapsed.has(id))) {
      setCollapsed((prev) => {
        const next = new Set(prev)
        for (const id of ancestors) next.delete(id)
        return next
      })
    }
  }, [selection, collapsed, store])

  const toggle = (id: CanvasNodeId) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const empty = useCanvasStore(
    (state) =>
      (getNode(state.doc, state.doc.rootId)?.children?.length ?? 0) === 0,
  )

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div
        role='tree'
        aria-label='Camadas do documento'
        aria-multiselectable
        className='min-h-0 flex-1 overflow-y-auto p-2'
      >
        <LayerRow id={rootId} depth={0} collapsed={collapsed} toggle={toggle} />
      </div>
      {empty && (
        <p className='px-4 pb-4 text-xs text-muted-foreground'>
          O documento está vazio. Arraste componentes da aba Adicionar.
        </p>
      )}
      <p className='border-t px-3 py-2 text-[11px] leading-snug text-muted-foreground'>
        Duplo clique renomeia. Arraste para reordenar ou mover para dentro de
        outro elemento.
      </p>
    </div>
  )
}
