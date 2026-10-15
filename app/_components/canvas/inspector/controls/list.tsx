'use client'

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Add01Icon,
  ArrowRight01Icon,
  Copy01Icon,
  Delete02Icon,
  DragDropVerticalIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'
import { getIn, setIn } from '@/src/lib/canvas/path'
import type { InspectorField } from '@/src/lib/canvas/registry'
import type { CanvasBreakpoint, CanvasNode } from '@/src/lib/canvas/types'
import { emptyValue, isFieldVisible, itemSummary } from '../../lib/fields'
import { FieldView } from '../field'
import type { ControlProps } from './primitives'

type Item = Record<string, unknown>

function newItem(fields: InspectorField[]): Item {
  let item: Item = {}
  for (const field of fields) {
    const value = emptyValue(field.control)
    if (value !== undefined) item = setIn(item, field.path, value)
  }
  return item
}

function ItemCard({
  sortId,
  index,
  item,
  fields,
  itemLabel,
  open,
  onToggle,
  onChange,
  onRemove,
  onDuplicate,
  canAdd,
  node,
  breakpoint,
}: {
  sortId: string
  index: number
  item: Item
  fields: InspectorField[]
  itemLabel: string
  open: boolean
  onToggle: () => void
  onChange: (item: Item) => void
  onRemove: () => void
  onDuplicate: () => void
  canAdd: boolean
  node: CanvasNode
  breakpoint: CanvasBreakpoint
}) {
  const sortable = useSortable({ id: sortId })
  const summary = itemSummary(item, fields, `${itemLabel} ${index + 1}`)
  return (
    <li
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={cn(
        'rounded-md border bg-background',
        sortable.isDragging && 'relative z-10 shadow-lg ring-1 ring-primary/40',
      )}
    >
      <div className='flex h-9 items-center gap-1 pr-1 pl-0.5'>
        <button
          type='button'
          ref={sortable.setActivatorNodeRef}
          {...sortable.attributes}
          {...sortable.listeners}
          aria-label={`Reordenar ${summary}`}
          className='flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing'
        >
          <SteelIcon icon={DragDropVerticalIcon} className='size-3.5' />
        </button>
        <button
          type='button'
          aria-expanded={open}
          onClick={onToggle}
          className='flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded px-1 text-left text-xs font-medium hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
        >
          <SteelIcon
            icon={ArrowRight01Icon}
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
          <span className='truncate'>{summary}</span>
        </button>
        {canAdd && (
          <button
            type='button'
            aria-label={`Duplicar ${summary}`}
            title='Duplicar'
            onClick={onDuplicate}
            className='flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground'
          >
            <SteelIcon icon={Copy01Icon} className='size-3.5' />
          </button>
        )}
        <button
          type='button'
          aria-label={`Remover ${summary}`}
          title='Remover'
          onClick={onRemove}
          className='flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
        >
          <SteelIcon icon={Delete02Icon} className='size-3.5' />
        </button>
      </div>
      {open && (
        <div className='flex flex-col gap-3 border-t px-2.5 py-3'>
          {fields
            .filter((field) => isFieldVisible(item, field))
            .map((field) => (
              <FieldView
                key={field.path}
                field={field}
                value={getIn(item, field.path)}
                onChange={(value) => onChange(setIn(item, field.path, value))}
                node={node}
                breakpoint={breakpoint}
              />
            ))}
        </div>
      )}
    </li>
  )
}

/** Repeating items (list rows, gallery images, tabs…): add, duplicate,
 * remove, drag to reorder; each item edits its own fields. */
export function ListControl({
  label,
  value,
  onChange,
  control,
  node,
  breakpoint,
}: ControlProps<'list', Item[]>) {
  const items = Array.isArray(value) ? value : []
  // Stable keys for sortable while items move (index-based keys would jump).
  const keys = useRef<string[]>([])
  const counter = useRef(0)
  while (keys.current.length < items.length) {
    keys.current.push(`item-${counter.current++}`)
  }
  if (keys.current.length > items.length) keys.current.length = items.length
  const [openKey, setOpenKey] = useState<string | null>(null)
  const canAdd = control.max === undefined || items.length < control.max
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = keys.current.indexOf(String(active.id))
    const to = keys.current.indexOf(String(over.id))
    keys.current = arrayMove(keys.current, from, to)
    onChange(arrayMove(items, from, to))
  }

  return (
    <div className='flex flex-col gap-1.5'>
      {items.length === 0 && (
        <p className='rounded-md border border-dashed px-3 py-3 text-center text-xs text-muted-foreground'>
          Nenhum item em {label.toLowerCase()}.
        </p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={keys.current}
          strategy={verticalListSortingStrategy}
        >
          <ul className='flex flex-col gap-1.5'>
            {items.map((item, index) => {
              const key = keys.current[index]
              return (
                <ItemCard
                  key={key}
                  sortId={key}
                  index={index}
                  item={item}
                  fields={control.fields}
                  itemLabel={control.itemLabel}
                  open={openKey === key}
                  onToggle={() => setOpenKey(openKey === key ? null : key)}
                  onChange={(next) =>
                    onChange(
                      items.map((current, i) => (i === index ? next : current)),
                    )
                  }
                  onRemove={() => {
                    keys.current.splice(index, 1)
                    onChange(items.filter((_, i) => i !== index))
                  }}
                  onDuplicate={() => {
                    const copy = structuredClone(item)
                    const newKey = `item-${counter.current++}`
                    keys.current.splice(index + 1, 0, newKey)
                    onChange([
                      ...items.slice(0, index + 1),
                      copy,
                      ...items.slice(index + 1),
                    ])
                    setOpenKey(newKey)
                  }}
                  canAdd={canAdd}
                  node={node}
                  breakpoint={breakpoint}
                />
              )
            })}
          </ul>
        </SortableContext>
      </DndContext>
      {canAdd && (
        <button
          type='button'
          onClick={() => {
            const key = `item-${counter.current++}`
            keys.current.push(key)
            onChange([...items, newItem(control.fields)])
            setOpenKey(key)
          }}
          className='inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-dashed text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/[0.03] hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
        >
          <SteelIcon icon={Add01Icon} className='size-3.5' />
          Adicionar {control.itemLabel.toLowerCase()}
        </button>
      )}
      {control.max !== undefined && (
        <span className='text-right text-[10px] text-muted-foreground tabular-nums'>
          {items.length} de {control.max}
        </span>
      )}
    </div>
  )
}
