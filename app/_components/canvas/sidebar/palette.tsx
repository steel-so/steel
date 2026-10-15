'use client'

import { Cancel01Icon, Search01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import type { CanvasComponentDefinition } from '@/src/lib/canvas/registry'
import { useCanvasDraggable } from '../dnd/canvas-dnd'
import { resolveIcon, useCanvasEditor } from '../editor-context'
import { findInsertLocation } from '../lib/drop-target'
import { paletteGroups } from '../lib/palette'

function PaletteTile({
  definition,
}: {
  definition: CanvasComponentDefinition
}) {
  const { catalog, store } = useCanvasEditor()
  const { setNodeRef, attributes, listeners, isDragging } = useCanvasDraggable(
    `palette:${definition.type}`,
    { kind: 'type', type: definition.type, label: definition.label },
  )
  const insert = () => {
    const { doc, selection } = store.getState()
    const at = findInsertLocation(
      doc,
      catalog,
      definition.type,
      selection[0] ?? null,
    )
    if (!at) {
      notify.info(`Não há onde inserir ${definition.label} neste documento.`)
      return
    }
    store.insertType(definition.type, at)
  }
  return (
    <button
      type='button'
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={insert}
      data-testid={`palette-item-${definition.type}`}
      aria-label={`${definition.label} — arraste para o canvas ou pressione Enter para inserir`}
      className={cn(
        'group flex h-[74px] cursor-grab touch-none flex-col items-center justify-center gap-1.5 rounded-lg border bg-background px-1 text-center text-[11px] leading-tight font-medium text-foreground/80 transition-[border-color,box-shadow,color,background-color] hover:border-primary/50 hover:bg-primary/[0.03] hover:text-foreground hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing',
        isDragging && 'border-primary/60 opacity-50',
      )}
    >
      <SteelIcon
        icon={resolveIcon(catalog, definition.icon)}
        className='size-5 text-muted-foreground transition-colors group-hover:text-primary'
      />
      <span className='line-clamp-2'>{definition.label}</span>
    </button>
  )
}

export function PaletteSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className='relative'>
      <SteelIcon
        icon={Search01Icon}
        className='pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground'
      />
      <input
        type='search'
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className='h-8 w-full rounded-md border bg-background pr-8 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 [&::-webkit-search-cancel-button]:hidden'
      />
      {value && (
        <button
          type='button'
          aria-label='Limpar busca'
          onClick={() => onChange('')}
          className='absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground'
        >
          <SteelIcon icon={Cancel01Icon} className='size-3.5' />
        </button>
      )}
    </div>
  )
}

/** "Adicionar": the catalog's components by category, searchable. Drag a
 * tile to the canvas (or to Camadas), or click/Enter to insert it at the
 * selection. */
export function Palette() {
  const { catalog } = useCanvasEditor()
  const [query, setQuery] = useState('')
  const groups = useMemo(() => paletteGroups(catalog, query), [catalog, query])
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='p-3 pb-2'>
        <PaletteSearch
          value={query}
          onChange={setQuery}
          placeholder='Buscar componentes'
        />
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto px-3 pb-4'>
        {groups.length === 0 && (
          <p className='px-1 py-8 text-center text-sm text-muted-foreground'>
            Nenhum componente encontrado para “{query}”.
          </p>
        )}
        {groups.map((group) => (
          <section key={group.category} className='mt-2 first:mt-0'>
            <h3 className='px-0.5 pt-2 pb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase'>
              {group.category}
            </h3>
            <div className='grid grid-cols-3 gap-1.5'>
              {group.items.map((definition) => (
                <PaletteTile key={definition.type} definition={definition} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
