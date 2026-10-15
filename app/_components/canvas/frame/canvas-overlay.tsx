'use client'

import type { IconSvgElement } from '@hugeicons/react'
import {
  ArrowUp01Icon,
  Copy01Icon,
  Delete02Icon,
  DragDropVerticalIcon,
  LockIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useLayoutEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'
import { getNode, parentOf } from '@/src/lib/canvas/ops'
import type { CanvasNodeId } from '@/src/lib/canvas/types'
import { nodeLabel, useCanvasDraggable } from '../dnd/canvas-dnd'
import {
  useCanvasEditor,
  useDragState,
  useFrameVersion,
} from '../editor-context'
import type { DropIndicator, Rect } from '../lib/drop-target'
import { frameRectOf } from '../lib/frame-handle'
import { useCanvasStore } from '../use-canvas'
import { FreeDrag } from './free-drag'
import { InlineToolbar } from './inline-toolbar'

function sameRect(a: Rect | null, b: Rect | null) {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.x === b.x &&
      a.y === b.y &&
      a.width === b.width &&
      a.height === b.height)
  )
}

/**
 * Measures a node's box after every commit (the DOM in the iframe is only
 * up to date then) and whenever the frame layout changes.
 */
function useNodeRect(id: CanvasNodeId | null): Rect | null {
  const { frame } = useCanvasEditor()
  const version = useFrameVersion()
  const doc = useCanvasStore((state) => state.doc)
  const breakpoint = useCanvasStore((state) => state.breakpoint)
  const [rect, setRect] = useState<Rect | null>(null)
  useLayoutEffect(() => {
    const next = id ? frameRectOf(frame, id) : null
    setRect((prev) => (sameRect(prev, next) ? prev : next))
  }, [id, frame, version, doc, breakpoint])
  return rect
}

function scaled(rect: Rect, scale: number) {
  return {
    left: rect.x * scale,
    top: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  }
}

function useScale() {
  const { frame } = useCanvasEditor()
  useFrameVersion()
  return frame.scale
}

function HoverOutline() {
  const { catalog, store } = useCanvasEditor()
  const hovered = useCanvasStore((state) =>
    state.hovered && !state.selection.includes(state.hovered)
      ? state.hovered
      : null,
  )
  const dragging = useDragState((state) => state.source !== null)
  const rect = useNodeRect(dragging ? null : hovered)
  const scale = useScale()
  if (!hovered || !rect || hovered === store.getState().doc.rootId) return null
  const box = scaled(rect, scale)
  return (
    <div
      data-testid='canvas-hover-outline'
      className='pointer-events-none absolute rounded-[2px] outline-1 outline-primary/70 outline-dashed'
      style={box}
    >
      <span className='absolute -top-5 left-0 rounded-sm bg-primary/90 px-1.5 py-0.5 text-[10px] leading-none font-medium whitespace-nowrap text-primary-foreground'>
        {nodeLabel(catalog, store, hovered)}
      </span>
    </div>
  )
}

function QuickAction({
  label,
  icon,
  onClick,
  destructive,
}: {
  label: string
  icon: IconSvgElement
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
      className={cn(
        'flex size-6 items-center justify-center rounded-[5px] text-primary-foreground/90 transition-colors hover:bg-primary-foreground/15 hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary-foreground/60 focus-visible:outline-none',
        destructive && 'hover:bg-destructive hover:text-white',
      )}
    >
      <SteelIcon icon={icon} className='size-3.5' />
    </button>
  )
}

function SelectionBox({ id, primary }: { id: CanvasNodeId; primary: boolean }) {
  const { catalog, store } = useCanvasEditor()
  const rect = useNodeRect(id)
  const scale = useScale()
  const editingText = useCanvasStore((state) => state.editingText === id)
  const node = useCanvasStore((state) => getNode(state.doc, id))
  const dragging = useDragState(
    (state) => state.source?.kind === 'node' && state.source.id === id,
  )
  // Child of a container in free positioning at this breakpoint: the box
  // itself is dragged to place it (`parentId\nchildPath`).
  const free = useCanvasStore((state) => {
    const parentId = parentOf(state.doc, id)
    const parent = parentId ? getNode(state.doc, parentId) : undefined
    const layout = parent && catalog.components[parent.type]?.freeLayout
    return parent && layout?.enabled(parent.props, state.breakpoint)
      ? `${parentId}\n${layout.childPath}`
      : null
  })
  const label = nodeLabel(catalog, store, id)
  const draggable = useCanvasDraggable(`canvas-node:${id}`, {
    kind: 'node',
    id,
    label,
  })
  if (!rect || !node) return null
  const box = scaled(rect, scale)
  const locked = !!node.meta?.locked
  const definition = catalog.components[node.type]
  const isRoot = id === store.getState().doc.rootId
  const chipBelow = box.top < 30
  return (
    <div
      data-testid='canvas-selection'
      data-node-id={id}
      className={cn(
        'pointer-events-none absolute rounded-[2px] outline-2 outline-primary',
        dragging && 'opacity-40',
        editingText && 'outline-1 outline-primary/60',
      )}
      style={box}
    >
      {free && primary && !locked && !editingText && (
        <FreeDrag
          id={id}
          parentId={free.split('\n')[0]}
          childPath={free.split('\n')[1]}
          rect={rect}
          scale={scale}
        />
      )}
      {primary && !isRoot && !editingText && (
        <div
          className={cn(
            'pointer-events-auto absolute left-[-2px] flex h-7 items-center gap-0.5 rounded-md bg-primary px-0.5 text-primary-foreground shadow-md',
            chipBelow ? 'top-[calc(100%+4px)]' : '-top-8',
          )}
        >
          {locked ? (
            <span className='flex items-center gap-1 px-1.5 text-[11px] font-medium'>
              <SteelIcon icon={LockIcon} className='size-3' />
              {label}
            </span>
          ) : (
            <button
              type='button'
              ref={draggable.setNodeRef}
              {...draggable.attributes}
              {...draggable.listeners}
              aria-label={`Mover ${label}`}
              className='flex h-6 cursor-grab touch-none items-center gap-1 rounded-[5px] pr-1.5 pl-0.5 text-[11px] font-medium hover:bg-primary-foreground/15 focus-visible:ring-2 focus-visible:ring-primary-foreground/60 focus-visible:outline-none active:cursor-grabbing'
            >
              <SteelIcon icon={DragDropVerticalIcon} className='size-3.5' />
              {label}
            </button>
          )}
          <QuickAction
            label='Selecionar o elemento pai'
            icon={ArrowUp01Icon}
            onClick={() => {
              const parent = parentOf(store.getState().doc, id)
              store.select(parent ? [parent] : null)
            }}
          />
          {!locked && (
            <>
              <QuickAction
                label='Duplicar'
                icon={Copy01Icon}
                onClick={() => store.duplicate([id])}
              />
              {!definition?.required && (
                <QuickAction
                  label='Excluir'
                  icon={Delete02Icon}
                  destructive
                  onClick={() => store.remove([id])}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Indicator({
  indicator,
  scale,
  label,
}: {
  indicator: DropIndicator
  scale: number
  label: string
}) {
  if (indicator.kind === 'inside') {
    const box = scaled(indicator.rect, scale)
    return (
      <div
        data-testid='canvas-drop-inside'
        className='pointer-events-none absolute rounded-[3px] bg-primary/8 outline-2 outline-primary outline-dashed'
        style={box}
      >
        <span className='absolute top-1/2 left-1/2 -translate-1/2 rounded-md bg-primary px-2 py-1 text-[11px] font-medium whitespace-nowrap text-primary-foreground shadow-sm'>
          Soltar em {label}
        </span>
      </div>
    )
  }
  const vertical = indicator.axis === 'vertical'
  const style = vertical
    ? {
        left: indicator.x * scale,
        top: indicator.y * scale - 1.5,
        width: indicator.length * scale,
        height: 3,
      }
    : {
        left: indicator.x * scale - 1.5,
        top: indicator.y * scale,
        width: 3,
        height: indicator.length * scale,
      }
  return (
    <div
      data-testid='canvas-drop-line'
      className='pointer-events-none absolute rounded-full bg-primary shadow-[0_0_0_1px_var(--background)] transition-[left,top,width,height] duration-75'
      style={style}
    >
      <span
        className={cn(
          'absolute size-2 rounded-full border-2 border-primary bg-background',
          vertical ? '-top-[2.5px] -left-1' : '-top-1 -left-[2.5px]',
        )}
      />
      <span
        className={cn(
          'absolute size-2 rounded-full border-2 border-primary bg-background',
          vertical ? '-top-[2.5px] -right-1' : '-bottom-1 -left-[2.5px]',
        )}
      />
    </div>
  )
}

function DropFeedback() {
  const { catalog, store } = useCanvasEditor()
  const target = useDragState((state) => state.target)
  const scale = useScale()
  const refusedId = target && !target.valid ? target.hoverId : null
  const refusedRect = useNodeRect(refusedId)
  if (!target) return null
  if (target.valid) {
    const parent = getNode(store.getState().doc, target.at.parentId)
    const label = parent
      ? (parent.meta?.name ?? catalog.components[parent.type]?.label ?? '')
      : ''
    return (
      <Indicator indicator={target.indicator} scale={scale} label={label} />
    )
  }
  if (!refusedRect) return null
  return (
    <div
      data-testid='canvas-drop-invalid'
      className='pointer-events-none absolute rounded-[2px] bg-destructive/5 outline-2 outline-destructive outline-dashed'
      style={scaled(refusedRect, scale)}
    >
      <span className='absolute -top-6 left-0 rounded-md bg-destructive px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-white'>
        Não pode ficar aqui
      </span>
    </div>
  )
}

/**
 * Editing layer drawn in the parent document over the iframe: hover
 * outline, selection boxes with quick actions, drop feedback and the inline
 * text toolbar. Nothing here ever reaches the document output.
 */
export function CanvasOverlay() {
  const selection = useCanvasStore((state) => state.selection)
  return (
    <div
      className='pointer-events-none absolute inset-0 z-10'
      data-testid='canvas-overlay'
    >
      <HoverOutline />
      {selection.map((id, index) => (
        <SelectionBox
          key={id}
          id={id}
          primary={index === 0 && selection.length === 1}
        />
      ))}
      <DropFeedback />
      <InlineToolbar />
    </div>
  )
}
